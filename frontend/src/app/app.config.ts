import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Hash URLs (#/builder?b=…): GitHub Pages serves only real files, so any
    // non-hash deep link (/builder) would 404. With hashes it always serves
    // index.html and the app reads the route, including share codes.
    provideRouter(routes, withHashLocation()),
  ],
};
