export type EmailValidationResponseType = {
  email_address: string;
  email_status?: string;
  email_sub_status?: string;
  account?: string;
  domain?: string;
  free_email?: boolean;
  domain_age_days?: number;
};

/** Possible email verification statuses */
export enum EmailStatus {
  /** The email is invalid (e.g., syntax issue) */
  INVALID = 'invalid',
  /** The email is valid*/
  VALID = 'valid',
  /** Domain does not exist or is unreachable */
  INVALID_DOMAIN = 'invalid_domain',
  /** Domain does not exist or is unreachable */
  SERVICE_UNAVAILABLE = 'service_unavailable',
  /** mailbox unavailable (e.g., mailbox busy or temporarily blocked for policy reasons)*/
  TEMPORARILY_UNAVAILABLE = 'service_temporarily_unavailable',
  /** The domain accepts all emails without validation */
  CATCH_ALL = 'catch-all',
  /** The email is a known spamtrap */
  SPAMTRAP = 'spamtrap',
  /** The email is flagged as do-not-mail */
  DO_NOT_MAIL = 'do_not_mail',
  /** The email status is not available */
  UNKNOWN = 'unknown',
}

/** Reasons why an email might be considered invalid */
export enum EmailReason {
  INVALID_EMAIL_FORMAT = 'invalid_email_format',
  DOMAIN_NOT_FOUND = 'domain_not_found',
  DOMAIN_WHOIS_DATA_NOT_FOUND = 'domain_whois_data_not_found',
  DOMAIN_WHOIS_PARSE_ERROR = 'domain_whois_data_parse_error',
  DOES_NOT_ACCEPT_MAIL = 'does_not_accept_mail',
  NO_MX_FOUND = 'mx_record_not_found',
  ROLE_BASED = 'role_based',
  IP_BLOCKED = 'ip_blocked',
  ALIAS = 'alias_or_forwarded_email',
  DISPOSABLE_DOMAIN = 'disposable_domain_temporary_email',
  POSSIBLE_TYPO = 'possible_typo',
  MAILBOX_NOT_FOUND = 'mailbox_not_found',
  UNVERIFIABLE_EMAIL = 'unverifiable_email',
  SMTP_TIMEOUT = 'smtp_connection_timeout',
  EMPTY = '',
}

export const SMTPResponseCode = {
  TWO_50: {
    smtp_code: 250,
    status: EmailStatus.VALID,
    reason: EmailReason.EMPTY,
    retry: false,
  },
  TWO_51: {
    smtp_code: 251,
    status: EmailStatus.VALID,
    reason: EmailReason.ALIAS,
    retry: false,
  },
  FIVE_50: {
    smtp_code: 550,
    status: EmailStatus.INVALID,
    reason: EmailReason.MAILBOX_NOT_FOUND,
    retry: false,
  },
  FIVE_51: {
    smtp_code: 551,
    status: EmailStatus.INVALID,
    reason: EmailReason.MAILBOX_NOT_FOUND,
    retry: false,
  },
  FIVE_05: {
    smtp_code: 505,
    status: EmailStatus.INVALID,
    reason: EmailReason.MAILBOX_NOT_FOUND,
    retry: false,
  },
  FIVE_00: {
    smtp_code: 500,
    status: EmailStatus.INVALID,
    reason: EmailReason.MAILBOX_NOT_FOUND,
    retry: false,
  },
  FIVE_53: {
    smtp_code: 553,
    status: EmailStatus.UNKNOWN,
    reason: EmailReason.UNVERIFIABLE_EMAIL,
    retry: false,
  },
  FIVE_54: {
    smtp_code: 554,
    status: EmailStatus.SERVICE_UNAVAILABLE,
    reason: EmailReason.IP_BLOCKED,
    retry: false,
  },
  FIVE_56: {
    smtp_code: 556,
    status: EmailStatus.INVALID,
    reason: EmailReason.MAILBOX_NOT_FOUND,
    retry: false,
  },
  FOUR_51: {
    smtp_code: 451,
    status: EmailStatus.TEMPORARILY_UNAVAILABLE,
    reason: EmailReason.IP_BLOCKED,
    retry: true,
  },
  FOUR_52: {
    smtp_code: 452,
    status: EmailStatus.TEMPORARILY_UNAVAILABLE,
    reason: EmailReason.IP_BLOCKED,
    retry: true,
  },
  FOUR_50: {
    smtp_code: 450,
    status: EmailStatus.TEMPORARILY_UNAVAILABLE,
    reason: EmailReason.IP_BLOCKED,
    retry: true,
  },
  FOUR_21: {
    smtp_code: 421,
    status: EmailStatus.TEMPORARILY_UNAVAILABLE,
    reason: EmailReason.IP_BLOCKED,
    retry: true,
  },
};

export type EmailStatusType = {
  status: EmailStatus;
  reason: EmailReason | string;
  retry?: boolean;
  smtp_code?: number;
};

export const ipBlockedStringsArray = [
  'permanently deferred', 'Spamhaus', 'cannot find your reverse hostname'
];