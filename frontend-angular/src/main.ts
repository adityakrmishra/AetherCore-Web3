import 'zone.js'; // Required for Angular to boot
import { platformBrowserDynamic } from '@angular/platform-browser-dynamic';
import { AppModule } from './app/app.module';

console.log("AETHERCORE ENGINE STARTING...");

platformBrowserDynamic().bootstrapModule(AppModule)
    .catch(err => console.error(err));