import { CdkCopyToClipboard } from '@angular/cdk/clipboard';
import { Component, inject } from '@angular/core';
import { MatButton } from '@angular/material/button';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { TokenStore } from './token-store';

/** Barra superior: marca, links e a URL do webhook com copiar. */
@Component({
  selector: 'app-token-bar',
  imports: [MatToolbar, MatButton, RouterLink, CdkCopyToClipboard],
  templateUrl: './token-bar.html',
  styleUrl: './token-bar.scss',
})
export class TokenBar {
  protected readonly tokens = inject(TokenStore);

  protected selectAll(event: Event): void {
    (event.target as HTMLInputElement).select();
  }
}
