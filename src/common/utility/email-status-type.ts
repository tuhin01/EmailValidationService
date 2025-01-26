export type EmailResponseType = {
  email_address: string,
  email_status?: string,
  email_sub_status?: string,
  account?: string,
  domain?: string,
  domain_age_days?: number,
}

export enum EmailStatus {
  INVALID = 'invalid',
  VALID = 'valid',
  INVALID_DOMAIN = 'invalid_domain',
  CATCH_ALL = 'catch-all',
  SPAMTRAP = 'spamtrap',
  UNKNOWN = 'unknown',
  DO_NOT_MAIL = 'do_not_mail'
}

export enum EmailReason {
  INVALID_EMAIL_FORMAT = 'invalid_email_format',
  DOMAIN_NOT_FOUND = 'domain_not_found',
  DOMAIN_WHOIS_DATA_NOT_FOUND = 'domain_whois_data_not_found',
  DOMAIN_WHOIS_PARSE_ERROR = 'domain_whois_data_parse_error',
  DOES_NOT_ACCEPT_MAIL = 'does_not_accept_mail',
  ROLE_BASED = 'role_based',
  DISPOSABLE_DOMAIN = 'disposable_domain_temporary_email',
  POSSIBLE_TYPO = 'possible_typo',
  MAILBOX_NOT_FOUND = 'mailbox_not_found',
  SMTP_TIMEOUT = 'smtp_connection_timeout',
  EMPTY = ''
}

export type EmailStatusType = {
  status: EmailStatus;
  reason: EmailReason | string;
};
