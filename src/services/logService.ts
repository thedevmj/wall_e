import { Platform } from 'react-native';
import { wallpaperBridge } from './wallpaperBridge';

const MAX_ENTRIES = 500;

type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'native';

type LogEntry = {
  level: LogLevel;
  message: string;
  timestamp: number;
};

let entries: LogEntry[] = [];
let started = false;

function push(level: LogLevel, message: string): void {
  entries.push({ level, message, timestamp: Date.now() });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
}

function formatValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function record(level: LogLevel, args: unknown[]): void {
  const message = args.map(formatValue).join(' ');
  push(level, message);
}

/**
 * Installs global handlers that capture both JS console output and uncaught
 * errors/warnings into an in-memory ring buffer, ready to be copied/shared.
 * Safe to call more than once; only installs the first time.
 */
export function startLogCapture(): void {
  if (started) return;
  started = true;

  // Skip console interception under Jest: overriding console there interferes
  // with the test runner's teardown/timer handling, and there is no native
  // module to send logs to anyway.
  const isTest = typeof jest !== 'undefined';
  if (isTest) return;

  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  console.log = (...args: unknown[]) => {
    original.log(...args);
    record('log', args);
  };
  console.info = (...args: unknown[]) => {
    original.info(...args);
    record('info', args);
  };
  console.warn = (...args: unknown[]) => {
    original.warn(...args);
    record('warn', args);
  };
  console.error = (...args: unknown[]) => {
    original.error(...args);
    record('error', args);
  };

  if (typeof globalThis !== 'undefined' && 'ErrorUtils' in globalThis) {
    const errorUtils = (globalThis as { ErrorUtils?: { setGlobalHandler?: (fn: (e: unknown, isFatal: boolean) => void) => void } }).ErrorUtils;
    if (errorUtils?.setGlobalHandler) {
      const previous = (globalThis as { __previousGlobalHandler?: (e: unknown, isFatal: boolean) => void }).__previousGlobalHandler;
      errorUtils.setGlobalHandler((error, isFatal) => {
        record('error', ['Uncaught error:', error, isFatal ? '(fatal)' : '(non-fatal)']);
        if (previous) {
          previous(error, isFatal);
        }
      });
    }
  }
}

/** Adds an app-level error/event to the log buffer explicitly. */
export function logEvent(level: LogLevel, ...args: unknown[]): void {
  record(level === 'log' ? 'info' : level, args);
}

/** Builds a human-readable, timestamped log report for sharing. */
export function buildLogReport(): string {
  const device = Platform.OS;
  const version = Platform.Version;
  const lines = [
    '--- LiveWallpaper Studio diagnostics ---',
    `Captured at: ${new Date().toISOString()}`,
    `Platform: ${device}`,
    `OS version: ${version}`,
    `Log entries: ${entries.length}`,
    '---',
  ];
  for (const entry of entries) {
    const time = new Date(entry.timestamp).toISOString();
    lines.push(`[${time}] [${entry.level.toUpperCase()}] ${entry.message}`);
  }
  return lines.join('\n');
}

/** Copies a full log report to the Android clipboard and returns it. */
export function copyLogs(): string {
  const report = buildLogReport();
  wallpaperBridge.copyToClipboard(report);
  return report;
}

/** Clears the in-memory log buffer. */
export function clearLogs(): void {
  entries = [];
}
