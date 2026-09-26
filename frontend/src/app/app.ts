import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TokenBar } from './token/token-bar';

@Component({
  imports: [RouterOutlet, TokenBar],
  selector: 'app-root',
  styleUrl: './app.scss',
  template: `
    <app-token-bar />
    <router-outlet />
  `,
})
export class App {}
