/**
 * =============================================================
 *  AetherCore-Web3 | /frontend-angular/src/app/app.module.ts
 *  Author  : AetherCore Team
 *  Version : 1.0.0
 *  Date    : 2026-03-12
 * =============================================================
 *
 *  PURPOSE:
 *  The root Angular module for the AetherCore Admin Dashboard.
 *  Imports all necessary Angular modules and bootstraps the
 *  AppComponent which hosts the AdminPanelComponent.
 *
 *  ARCHITECTURE NOTE:
 *  - AdminPanelComponent is declared as a standalone component
 *    (Angular 17+), so it is imported here rather than declared.
 *  - Both Web3AdminService and ApiService are `providedIn: 'root'`
 *    so they do not need to be listed in providers here.
 *  - HttpClientModule is imported at module level so that Angular's
 *    DI system can inject HttpClient into ApiService.
 * =============================================================
 */

import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { HttpClientModule } from '@angular/common/http';
import { FormsModule } from '@angular/forms';

import { AppComponent } from './app.component';
import { AdminPanelComponent } from './components/admin-panel.component';

@NgModule({
  declarations: [
    AppComponent, // Root component — bootstrapped below
  ],
  imports: [
    BrowserModule,       // Required for any browser-side Angular app
    HttpClientModule,    // Provides HttpClient for ApiService
    FormsModule,         // Provides [(ngModel)] two-way binding

    // Standalone components are imported here, not declared
    AdminPanelComponent,
  ],
  providers: [
    // Web3AdminService and ApiService are providedIn: 'root' — auto-provided.
    // Add any HTTP interceptors here if needed in the future:
    // { provide: HTTP_INTERCEPTORS, useClass: AuthInterceptor, multi: true }
  ],
  bootstrap: [AppComponent],
})
export class AppModule { }
