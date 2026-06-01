declare module "gmail-js" {
  export type GmailEmailData = {
    thread_id?: string
    first_email?: string
    last_email?: string
    subject?: string
    labels?: string[]
    threads?: Record<
      string,
      {
        from?: string
        from_email?: string
        to?: string[]
        cc?: string[]
        bcc?: string[]
        subject?: string
        datetime?: string
        content_plain?: string
        content_html?: string
        labels?: string[]
      }
    >
  }

  export type GmailContact = {
    name?: string
    address?: string
  }

  export type GmailCachedEmail = {
    id?: string
    legacy_email_id?: string
    thread_id?: string
    subject?: string
    timestamp?: number
    content_html?: string | null
    date?: Date | string
    from?: GmailContact
    to?: GmailContact[]
    cc?: GmailContact[]
    bcc?: GmailContact[]
    attachments?: unknown[]
    labels?: string[]
  }

  export type GmailThreadData = {
    thread_id?: string
    emails?: GmailCachedEmail[]
  }

  export type GmailVisibleEmail = {
    id?: string
    thread_id?: string
    threadId?: string
    labels?: string[]
  }

  export class Gmail {
    constructor(localJQuery: false)
    cache: {
      emailIdCache: Record<string, GmailCachedEmail | undefined>
      emailLegacyIdCache: Record<string, GmailCachedEmail | undefined>
      threadCache: Record<string, GmailThreadData | undefined>
    }
    get: {
      current_page(): string
      email_id(): string
      thread_id(): string
      email_subject(): string
      labels(): string[]
      visible_emails(): Array<string | GmailVisibleEmail>
      email_data(threadId?: string): GmailEmailData
    }
    new: {
      get: {
        email_id(): string | null
        thread_id(): string | null
        email_data(identifier?: string): GmailCachedEmail | null
        thread_data(identifier?: string): GmailThreadData | null
      }
    }
  }
}
