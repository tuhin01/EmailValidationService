import { Injectable } from '@nestjs/common';
import * as net from 'net';
import * as tls from 'tls';
import {
  EmailReason,
  EmailStatus,
  EmailStatusType,
  ipBlockedStringsArray,
  SMTPResponseCode,
} from '@/common/utility/email-status-type';
import { DomainService } from '@/domains/services/domain.service';
import { WinstonLoggerService } from '@/logger/winston-logger.service';
import { randomStringGenerator } from '@nestjs/common/utils/random-string-generator.util';

@Injectable()
export class SmtpConnectionService {
  private socket: net.Socket | tls.TLSSocket;
  private host: string;
  private readonly port: number = 25; // Use 465 for SSL, 587 for STARTTLS

  constructor(
    private winstonLoggerService: WinstonLoggerService,
  ) {
  }

  async connect(mxHost): Promise<void> {
    return new Promise(async (resolve, reject) => {
      console.log(`🔄 Connecting to SMTP server: ${this.host}:${this.port}...`);
      this.host = mxHost;
      this.socket = net.createConnection(this.port, this.host, () => {
        console.log('✅ Connected to SMTP server. Waiting for response...');
      });

      this.socket.setEncoding('utf-8');
      this.socket.setTimeout(5000);

      this.socket.once('data', async (data) => {
        try {
          const ehloResponse = await this.sendCommand(`EHLO ${this.host}`);
          if (ehloResponse.includes('STARTTLS')) {
            await this.sendCommand(`STARTTLS`);
            // Step 3: Upgrade Connection to TLS
            console.log('🔒 Upgrading to TLS...');
            const secureSocket = tls.connect(
              {
                socket: this.socket,
                port: 587,
                host: this.host,
                servername: this.host,
                rejectUnauthorized: false, // Allow self-signed certificates
              },
              () => {
                if (secureSocket.authorized) {
                  console.log('Authorized');
                }
                if (secureSocket.encrypted) {
                  console.log('✅ TLS secured. Ready to authenticate.');
                  this.socket = secureSocket; // Replace with secure socket

                  this.socket.removeAllListeners('data');
                  resolve();
                }
              },
            );
          }
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  private async sendCommand(command: string, email = ''): Promise<string> {
    return new Promise((resolve, reject) => {
      this.socket.write(command + '\r\n', 'utf-8', () => {
        console.debug(`➡ Sent: ${command}`);
      });

      let responseData = '';
      this.socket.once('data', (data) => {
        responseData = data.toString();
        console.debug(`⬅ Received: ${responseData}`);
        resolve(responseData);
        return;
      });

      this.socket.once('close', () => {
        console.log('Closing...');
        // If the socket is closed by the SMTP server without letting us complete
        // all commands then it probably blocked our IP. But if all commands
        // completed and SMTP response has code above 400, the email address is invalid
        if (responseData) {
          const responseCode = parseInt(responseData.substring(0, 3));
          if (responseCode >= 400) {
            reject(EmailReason.DOES_NOT_ACCEPT_MAIL);
          }
        } else {
          reject(EmailReason.IP_BLOCKED);
        }
        return;
      });

      this.socket.on('error', (err) => {
        // Log the error
        this.winstonLoggerService.error(`verifySmtp() error - ${email}`, JSON.stringify(err));
        // Detect if the connection is blocked
        if (err.message.includes('ECONNREFUSED') || err.message.includes('EHOSTUNREACH')) {
          reject(EmailReason.IP_BLOCKED);
        } else {
          reject(err.message);
        }
        return;
      });

      this.socket.on('timeout', () => {
        // Log the error
        this.winstonLoggerService.error(`verifySmtp() timeout - ${email}`, responseData);
        resolve(EmailReason.SMTP_TIMEOUT);
        return;
      });
    });
  }

  async verifyEmail(email: string): Promise<EmailStatusType> {
    const mailFrom = 'fwork03@gmail.com';
    const [account, domain] = email.split('@');
    const catchAllEmail = `${randomStringGenerator()}${Date.now()}@${domain}`;
    return new Promise(async (resolve, reject): Promise<EmailStatusType> => {
      try {
        await this.sendCommand(`EHLO ${this.host}`);
        await this.sendCommand(`MAIL FROM:<${mailFrom}>`);
        const responseCatchAllRcptTo = await this.sendCommand(`RCPT TO:<${catchAllEmail}>`, catchAllEmail);
        const catchAllEmailStatus: EmailStatusType = this.parseSmtpResponseData(responseCatchAllRcptTo, catchAllEmail);
        if (catchAllEmailStatus.status === EmailStatus.VALID) {
          const error: EmailStatusType = {
            status: EmailStatus.CATCH_ALL,
            reason: EmailReason.EMPTY,
          };
          reject(error);

          return;
        }
        const responseRcptTo = await this.sendCommand(`RCPT TO:<${email}>`, email);
        await this.sendCommand(`QUIT`);

        const emailStatus: EmailStatusType = this.parseSmtpResponseData(responseRcptTo, email);
        resolve(emailStatus);
      } catch (e) {
        await this.sendCommand(`QUIT`);
        reject(e);
      }
    });
  }

  public parseSmtpResponseData(
    data: string,
    email: string,
  ): EmailStatusType {
    if (data.includes(SMTPResponseCode.TWO_50.smtp_code.toString())) {
      return SMTPResponseCode.TWO_50;
    } else if (data.includes(SMTPResponseCode.TWO_51.smtp_code.toString())) {
      return SMTPResponseCode.TWO_51;
    } else if (
      data.includes(SMTPResponseCode.FIVE_50.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_56.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_05.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_51.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FIVE_00.smtp_code.toString())
    ) {
      let error: EmailStatusType = { reason: undefined, status: undefined };
      this.winstonLoggerService.error(`(500,556,505,551,550) - ${email}`, data);

      // Check if "data" has any of the strings from 'ipBlockedStringsArray'
      for (const str of ipBlockedStringsArray) {
        if (data.includes(str)) {
          error.status = EmailStatus.SERVICE_UNAVAILABLE;
          error.reason = EmailReason.IP_BLOCKED;
          return error;
        }
      }

      return SMTPResponseCode.FIVE_50;
    } else if (
      // Detect Gray listing (Temporary Failures)
      data.includes(SMTPResponseCode.FOUR_21.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_50.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_51.smtp_code.toString()) ||
      data.includes(SMTPResponseCode.FOUR_52.smtp_code.toString())
    ) {
      return SMTPResponseCode.FOUR_21;
    } else if (data.includes(SMTPResponseCode.FIVE_53.smtp_code.toString())) {
      return SMTPResponseCode.FIVE_53;
    } else if (data.includes(SMTPResponseCode.FIVE_54.smtp_code.toString())) {
      return SMTPResponseCode.FIVE_54;
    } else {
      console.log(data);
      let error: EmailStatusType = { reason: undefined, status: undefined };
      // When no other condition is true, handle it for all other codes
      // Response code starts with "4" - Temporary error, and we should retry later
      // Response code starts with "5" - Permanent error and must not retry
      if (data) {
        // Log the response
        if (!data.startsWith('2')) {
          this.winstonLoggerService.error(`verifySmtp() else - ${email}`, data);
        }

        if (data.startsWith(EmailReason.SMTP_TIMEOUT)) {
          error.status = EmailStatus.UNKNOWN;
          error.reason = EmailReason.SMTP_TIMEOUT;
          return error;
        } else if (data.startsWith(EmailReason.IP_BLOCKED)) {
          return SMTPResponseCode.FIVE_54;
        } else if (data.startsWith('4')) {
          return SMTPResponseCode.FOUR_51;
        } else if (data.startsWith('5')) {
          return SMTPResponseCode.FIVE_50;
        } else {
          error.status = EmailStatus.UNKNOWN;
          error.reason = data;
          return error;
        }
      }
    }

  }
}
