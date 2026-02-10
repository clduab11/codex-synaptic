/**
 * TUI Themes
 * 
 * Theme definitions for the Ink-based Terminal User Interface.
 */

import type { TuiTheme } from './types.js';

/**
 * Dark theme (default)
 */
export const darkTheme: TuiTheme = {
  name: 'dark',
  colors: {
    primary: '#61afef',
    secondary: '#c678dd',
    success: '#98c379',
    warning: '#e5c07b',
    error: '#e06c75',
    info: '#56b6c2',
    background: '#282c34',
    foreground: '#abb2bf',
    muted: '#5c6370',
    border: '#3e4451',
    highlight: '#2c313c',
  },
  unicode: true,
};

/**
 * Light theme
 */
export const lightTheme: TuiTheme = {
  name: 'light',
  colors: {
    primary: '#4078f2',
    secondary: '#a626a4',
    success: '#50a14f',
    warning: '#c18401',
    error: '#e45649',
    info: '#0184bc',
    background: '#fafafa',
    foreground: '#383a42',
    muted: '#a0a1a7',
    border: '#d3d4d5',
    highlight: '#f0f0f0',
  },
  unicode: true,
};

/**
 * High contrast theme
 */
export const highContrastTheme: TuiTheme = {
  name: 'high-contrast',
  colors: {
    primary: '#00ffff',
    secondary: '#ff00ff',
    success: '#00ff00',
    warning: '#ffff00',
    error: '#ff0000',
    info: '#0080ff',
    background: '#000000',
    foreground: '#ffffff',
    muted: '#808080',
    border: '#ffffff',
    highlight: '#404040',
  },
  unicode: false, // Better compatibility in high-contrast mode
};

/**
 * Get theme by name
 */
export function getTheme(name: TuiTheme['name']): TuiTheme {
  switch (name) {
    case 'light':
      return lightTheme;
    case 'high-contrast':
      return highContrastTheme;
    case 'dark':
    default:
      return darkTheme;
  }
}

/**
 * Available theme names
 */
export const themeNames: TuiTheme['name'][] = ['dark', 'light', 'high-contrast'];
