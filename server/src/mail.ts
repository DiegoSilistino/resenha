import nodemailer from "nodemailer";
import type { Config } from "./config.ts";

/** Manda e-mail de texto (códigos para confirmar o endereço e para trocar a senha). */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** null sem SMTP configurado: aí o app não oferece nada que dependa de e-mail. */
export function createMailer(smtp: Config["smtp"]): Mailer | null {
  if (!smtp) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.port === 465, // 465 já conecta criptografado; 587 sobe para TLS (STARTTLS)
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.pass ?? "" } } : {}),
  });
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: smtp.from, to, subject, text });
    },
  };
}
