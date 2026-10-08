import { Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';

import { ServerStatus } from './shared/server-status/server-status';

/** The shell: the app name linking home and the server status above every page (docs/client.md#routes--lobby-flow). */
@Component({
  selector: 'app-root',
  imports: [RouterLink, RouterOutlet, ServerStatus],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {}
