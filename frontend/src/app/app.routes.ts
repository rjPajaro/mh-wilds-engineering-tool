import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: 'builder', loadComponent: () => import('./features/builder/builder').then((m) => m.Builder) },
  { path: 'artian', loadComponent: () => import('./features/artian-forge/artian-forge').then((m) => m.ArtianForge) },
  { path: 'talismans', loadComponent: () => import('./features/talismans/talismans').then((m) => m.Talismans) },
  { path: '', pathMatch: 'full', redirectTo: 'builder' },
  { path: '**', redirectTo: 'builder' },
];
