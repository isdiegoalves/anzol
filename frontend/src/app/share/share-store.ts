import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ShareLink, ShareOptions, SharedRequest } from './share';

/** Links só-leitura de mensagens: criar, listar e revogar (gestão da URL) e ler (público). */
@Injectable({ providedIn: 'root' })
export class ShareStore {
  private readonly http = inject(HttpClient);

  create(tokenId: string, requestId: string, options: ShareOptions): Promise<ShareLink> {
    return firstValueFrom(
      this.http.post<ShareLink>(`/token/${tokenId}/request/${requestId}/share`, options),
    );
  }

  /** Links ativos da URL, de todas as mensagens. */
  list(tokenId: string): Promise<ShareLink[]> {
    return firstValueFrom(this.http.get<ShareLink[]>(`/token/${tokenId}/shares`));
  }

  async revoke(tokenId: string, shareId: string): Promise<void> {
    await firstValueFrom(this.http.delete(`/token/${tokenId}/shares/${shareId}`));
  }

  /** Expirado, revogado ou com a mensagem apagada: 404, igual para os três. */
  read(shareId: string): Promise<SharedRequest> {
    return firstValueFrom(this.http.get<SharedRequest>(`/share/${shareId}`));
  }
}
