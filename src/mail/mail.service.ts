import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
}

/**
 * Envía correos con Resend. Sin RESEND_API_KEY (desarrollo) solo los escribe en el log.
 * Nunca lanza: un correo que falla no debe deshacer una venta o una reserva.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly key?: string;
  private readonly from: string;

  constructor(config: ConfigService) {
    this.key = config.get<string>('RESEND_API_KEY');
    this.from = config.get<string>('MAIL_FROM') ?? 'Nara Studio <onboarding@resend.dev>';
  }

  async send(mail: Mail): Promise<void> {
    const to = [mail.to].flat().filter(Boolean);
    if (!to.length) return;
    if (!this.key) {
      const text = mail.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      this.logger.log(`[sin RESEND_API_KEY] "${mail.subject}" → ${to.join(', ')}: ${text}`);
      return;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: this.from, to, subject: mail.subject, html: mail.html }),
      });
      if (!res.ok) this.logger.error(`Resend respondió ${res.status} al enviar "${mail.subject}": ${await res.text()}`);
    } catch (e) {
      this.logger.error(`No se pudo enviar "${mail.subject}"`, e);
    }
  }
}
