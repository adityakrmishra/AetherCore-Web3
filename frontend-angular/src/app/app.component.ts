import { Component } from '@angular/core';

@Component({
  selector: 'app-root',
  // This single line tells Angular to load your beautiful new dashboard!
  template: `<app-admin-panel></app-admin-panel>`,
})
export class AppComponent {
  title = 'AetherCore Admin';
}