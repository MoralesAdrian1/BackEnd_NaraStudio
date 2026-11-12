import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const BUCKET = 'students';
const EXPIRES_S = 60 * 60; // los enlaces a las fotos vencen en una hora

/**
 * Fotos de las alumnas: el bucket es privado, así que la app las muestra con enlaces firmados
 * que genera el servidor (con la secret key) y vencen en una hora.
 */
@Injectable()
export class StudentPhotos {
  private readonly logger = new Logger(StudentPhotos.name);
  private readonly url: string;
  private readonly key?: string;

  constructor(config: ConfigService) {
    this.url = `${config.getOrThrow<string>('SUPABASE_URL')}/storage/v1`;
    this.key = config.get<string>('SUPABASE_SECRET_KEY');
  }

  private headers() {
    return { apikey: this.key!, authorization: `Bearer ${this.key}`, 'content-type': 'application/json' };
  }

  /** Enlace firmado para cada ruta (en una sola petición). Sin secret key o si falla: sin foto. */
  async sign(paths: (string | null | undefined)[]): Promise<Map<string, string>> {
    const unique = [...new Set(paths.filter((p): p is string => !!p))];
    const urls = new Map<string, string>();
    if (!unique.length || !this.key) return urls;
    try {
      const res = await fetch(`${this.url}/object/sign/${BUCKET}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ expiresIn: EXPIRES_S, paths: unique }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as { path: string | null; signedURL: string | null }[];
      for (const r of rows) if (r.path && r.signedURL) urls.set(r.path, `${this.url}${r.signedURL}`);
    } catch (e) {
      this.logger.warn(`No se pudieron firmar las fotos: ${(e as Error).message}`);
    }
    return urls;
  }

  /** Todos los archivos de la carpeta de una cuenta (al borrarla). */
  async removeFolder(userId: string) {
    if (!this.key) return;
    const res = await fetch(`${this.url}/object/list/${BUCKET}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
    });
    const files = res.ok ? ((await res.json()) as { name: string }[]) : [];
    if (!files.length) return;
    await fetch(`${this.url}/object/${BUCKET}`, {
      method: 'DELETE',
      headers: this.headers(),
      body: JSON.stringify({ prefixes: files.map((f) => `${userId}/${f.name}`) }),
    });
  }
}

@Global()
@Module({ providers: [StudentPhotos], exports: [StudentPhotos] })
export class StudentPhotosModule {}
