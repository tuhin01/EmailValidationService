const express = require('express');
const dns = require('dns');
var lookup = require('./dnsbl'); // inside module
const net = require('net');
const whois = require('whois');
const parseWhois = require('parse-whois');
const disposableDomains = require('./disposableDomains');
const roles = require('./roles');

const app = express();
app.use(express.json());

// Validate email syntax
function validateEmailFormat(email) {
    const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return emailRegex.test(email);
}

// Check domain MX records
function checkDomainMxRecords(domain) {
    return new Promise((resolve, reject) => {
        dns.resolveMx(domain, (err, addresses) => {
            if (err || !addresses || addresses.length === 0) {
                return reject('no_dns_entries');
            }
            addresses.sort((a, b) => a.priority - b.priority);
            resolve(addresses);
        });
    });
}

// Check if the domain is disposable
function isDisposableDomain(domain) {
    return disposableDomains.includes(domain);
}

async function isDomainBlackListed(domain) {
    return new Promise((resolve, reject) => {
        const uribl = new lookup.dnsbl(domain);

        uribl.on('error', function (error, blocklist) {
            //console.log(error, blocklist);
            //reject(error)
        });
        uribl.on('data', function (result, blocklist) {
            console.log(result.status + ' in ' + blocklist.zone);
            if (result.status === 'listed') {
                console.log(result);
                resolve(true);
            }
        });
        uribl.on('done', function () {
            resolve(false)
        });
    })
}

// Perform WHOIS lookup for domain age
function getDomainAge(domain) {
    return new Promise((resolve, reject) => {
        whois.lookup(domain, (err, data) => {
            if (err) return reject(err);

            try {
                const parsedData = parseWhois.parseWhoIsData(data);
                // console.log({parsedData})
                const domainAge = parsedData.find((p) => p.attribute === 'Creation Date');
                const creationDate = domainAge?.value;

                if (!creationDate) {
                    return reject('Creation date not found in WHOIS data.');
                }

                const registrationDate = new Date(creationDate);
                const ageInYears = (Date.now() - registrationDate.getTime()) / (1000 * 60 * 60 * 24 * 365);

                resolve({
                    creationDate: registrationDate.toISOString(),
                    ageInYears: Math.floor(ageInYears),
                });
            } catch (err) {
                return reject('Error parsing WHOIS data.');
            }
        });
    });
}

// Verify email via SMTP
function verifySmtp(email, mxHost) {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(25, mxHost);
        socket.setEncoding('ascii');
        socket.setTimeout(5000);

        const commands = [
            `EHLO ${mxHost}`,
            `MAIL FROM: <tuhin.world@gmail.com>`,
            `RCPT TO: <${email}>`,
        ];

        let stage = 0;

        socket.on('connect', () => {
            socket.write(`${commands[stage++]}\r\n`);
        });

        socket.on('data', (data) => {
            console.log(data)
            if (data.includes('250') && stage < commands.length) {
                socket.write(`${commands[stage++]}\r\n`);
            } else if (data.includes('550')) {
                closeSmtpConnection(socket);
                resolve({
                    status: 'invalid',
                    reason: "mailbox_not_found"
                })
            } else if (stage === commands.length) {
                closeSmtpConnection(socket);
                resolve({
                    status: "valid",
                    reason: ""
                });
            }
        });

        socket.on('error', (err) => {
            closeSmtpConnection(socket);
            resolve({
                status: "unknown",
                reason: err.message
            })
        });

        socket.on('timeout', () => {
            closeSmtpConnection(socket);
            resolve({
                status: "unknown",
                reason: "SMTP connection timed out"
            })
        });
    });
}

function closeSmtpConnection(socket) {
    socket.write('QUIT\r\n');
    socket.end();
}

// Detect role-based emails
function isRoleBasedEmail(email) {
    const localPart = email.split('@')[0].toLowerCase();
    return roles.includes(localPart);
}

// Email validation endpoint
app.post('/validate', async (req, res) => {
    const {email} = req.body;

    if (!email) {
        return res.status(400).json({status: 'error', message: 'Email is required'});
    }

    if (!validateEmailFormat(email)) {
        return res.status(400).json({status: 'invalid', reason: 'invalid_email_format'});
    }

    const domain = email.split('@')[1];

    if (isRoleBasedEmail(email)) {
        return res.json({status: 'do_not_mail', reason: 'role_based'});
    }

    if (isDisposableDomain(domain)) {
        return res.json({status: 'do_not_mail', reason: 'disposable_domain'});
    }

    const blacklisted = await isDomainBlackListed(domain);
    if (blacklisted) {
        return res.json({status: 'spamtrap', reason: ''});
    }

    try {
        const domainInfo = await getDomainAge(domain);
        console.log({domainInfo})
        const mxRecords = await checkDomainMxRecords(domain);
        const mxHost = mxRecords[0].exchange;

        const catchAllEmail = `randomaddress12345@${domain}`;
        const isCatchAllValid = await verifySmtp(catchAllEmail, mxHost);
        if (isCatchAllValid.status === 'valid') {
            return res.json({status: 'catch-all', reason: ''});
        }

        const response = await verifySmtp(email, mxHost);
        console.log({response})
        return res.json(response);

    } catch (error) {
        return res.status(400).json({status: 'invalid', reason: error});
    }
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Email validation service running on port ${PORT}`);
});
