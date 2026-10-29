import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Lo que solo hace el servidor en Supabase Auth, con la secret key: crear cuentas y generar
 * enlaces para poner contraseña. La key nunca sale del backend.
 */
@Injectable()
export class SupabaseAdmin {
  private readonly url: string;
  private readonly key?: string;
  private readonly appUrl: string;

  constructor(config: ConfigService) {
    this.url = `${config.getOrThrow<string>('SUPABASE_URL')}/auth/v1`;
    this.key = config.get<string>('SUPABASE_SECRET_KEY');
    this.appUrl = config.get<string>('APP_URL') ?? 'http://localhost:5173';
  }

  private async call<T>(path: string, body: unknown): Promise<T> {
    if (!this.key) throw new ServiceUnavailableException('Falta SUPABASE_SECRET_KEY en el servidor para crear cuentas');
    const res = await fetch(`${this.url}${path}`, {
      method: 'POST',
      headers: { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as T & { msg?: string; message?: string; error_code?: string };
    if (json.error_code === 'email_exists') throw new ConflictException('Ya existe una cuenta con ese correo');
    if (!res.ok) throw new ServiceUnavailableException(`Supabase Auth: ${json.msg ?? json.message ?? res.status}`);
    return json;
  }

  /** Crea la cuenta con el correo ya confirmado: la coach la dio de alta en persona. */
  createUser(email: string, fullName: string) {
    return this.call<{ id: string }>('/admin/users', {
      email,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
  }

  /**
   * Enlace para crear la contraseña. Supabase no manda correo: lo mandamos nosotras. Se pasa el
   * token en la URL (y no el enlace de Supabase) porque la app inicia sesión con PKCE.
   */
  async passwordLink(email: string) {
    const { hashed_token } = await this.call<{ hashed_token: string }>('/admin/generate_link', { type: 'recovery', email });
    const q = new URLSearchParams({ token_hash: hashed_token, type: 'recovery', invitacion: '1' });
    return `${this.appUrl}/restablecer?${q}`;
  }

  /** Si algo falla después de crear la cuenta, se borra para no dejarla huérfana. */
  async deleteUser(id: string) {
    if (!this.key) return;
    await fetch(`${this.url}/admin/users/${id}`, {
      method: 'DELETE',
      headers: { apikey: this.key, authorization: `Bearer ${this.key}` },
    }).catch(() => undefined);
  }
}
