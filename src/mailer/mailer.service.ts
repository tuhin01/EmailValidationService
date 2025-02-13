import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import * as process from 'node:process';
import * as hbs from 'nodemailer-express-handlebars';

@Injectable()
export class MailerService {
  private transporter: nodemailer.Transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: false, // true for 465, false for other ports
      from: process.env.SMTP_FROM_NAME,
      auth: {
        user: process.env.SMTP_USERNAME, // Your email
        pass: process.env.SMTP_PASSWORD, // Your email password or app password
      },
    });

    // Configure Handlebars
    this.transporter.use(
      'compile',
      hbs({
        viewEngine: {
          extname: '.hbs',
          layoutsDir: './src/mailer/templates',
          defaultLayout: false,
        },
        viewPath: './src/mailer/templates',
        extName: '.hbs',
      }),
    );
  }

  async verifySMTP() {
    try {
      console.log("A");
      const response = await this.transporter.verify();
      console.log('✅ SMTP connection is valid!');
      return response;
    } catch (error) {
      console.error('❌ SMTP connection failed:', error);
      return error;
    }
  }

  async sendEmail({ to, subject, template, context }) {
    const mailOptions = {
      from: process.env.SMTP_FROM_EMAIL,
      to,
      subject,
      template, // Handlebars template name (without .hbs)
      context, // Dynamic data for template
    };

    try {
      const info = await this.transporter.sendMail(mailOptions);
      console.log('Email sent: ', info.messageId);
      return info;
    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  }
}
