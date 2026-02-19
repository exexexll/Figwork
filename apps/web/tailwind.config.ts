import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Figwork brand colors
        primary: {
          DEFAULT: '#a78bfa',
          light: '#c4b5fd',
          dark: '#8b5cf6',
        },
        secondary: {
          DEFAULT: '#f9a8d4',
          light: '#fbcfe8',
        },
        accent: {
          DEFAULT: '#fcd34d',
          light: '#fef3c7',
          warm: '#fdba74',
        },
        background: {
          DEFAULT: '#fefefe',
          secondary: '#faf8fc',
          warm: '#fffbf5',
        },
        text: {
          primary: '#1f1f2e',
          secondary: '#6b6b80',
          muted: '#a0a0b0',
        },
        border: {
          DEFAULT: '#e8e4f0',
          light: '#f3f0f8',
        },
      },
      fontFamily: {
        sans: ['var(--font-nunito-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-fira-code)', 'monospace'],
      },
      borderRadius: {
        'sm': '8px',
        'md': '12px',
        'lg': '20px',
        'xl': '28px',
      },
      boxShadow: {
        'soft-sm': '0 1px 3px rgba(167, 139, 250, 0.08)',
        'soft-md': '0 4px 16px rgba(167, 139, 250, 0.12)',
        'soft-lg': '0 12px 40px rgba(167, 139, 250, 0.16)',
        'glow': '0 0 24px rgba(167, 139, 250, 0.2)',
        'glow-strong': '0 0 40px rgba(167, 139, 250, 0.5), 0 0 80px rgba(249, 168, 212, 0.3)',
      },
      backgroundImage: {
        'gradient-fig': 'linear-gradient(135deg, #c4b5fd 0%, #f9a8d4 50%, #fef3c7 100%)',
        'gradient-fig-subtle': 'linear-gradient(135deg, rgba(196,181,253,0.1) 0%, rgba(249,168,212,0.1) 50%, rgba(254,243,199,0.1) 100%)',
      },
      animation: {
        'pulse-slow': 'pulse-slow 2s ease-in-out infinite',
        'ping-slow': 'ping-slow 1.5s ease-out infinite',
        'slide-in-right': 'slide-in-right 0.25s ease-out',
      },
      keyframes: {
        'pulse-slow': {
          '0%, 100%': { opacity: '0.6', transform: 'scale(1.3)' },
          '50%': { opacity: '0.8', transform: 'scale(1.4)' },
        },
        'ping-slow': {
          '0%': { opacity: '0.4', transform: 'scale(1.15)' },
          '75%, 100%': { opacity: '0', transform: 'scale(1.5)' },
        },
        'slide-in-right': {
          '0%': { opacity: '0', transform: 'translateX(1rem)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
