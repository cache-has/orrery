#!/usr/bin/env node
export {};

const command = process.argv[2];

switch (command) {
  case "dev":
    await import("./dev.js");
    break;
  case "serve":
    await import("./serve.js");
    break;
  case "validate":
    await import("./validate.js");
    break;
  case "build":
    await import("./build.js");
    break;
  case "diff":
    await import("./diff.js");
    break;
  case "create":
    await import("./create.js");
    break;
  default:
    console.log(`
  OpenBoard — Dashboards as code, not clicks.

  Usage:
    openboard dev          Start dev server with hot reload
    openboard serve        Start production HTTP server (no watcher/hot reload)
    openboard build        Export static HTML dashboards
    openboard validate     Validate .board files and connections
    openboard diff         Compare dashboards between git refs
    openboard create       Scaffold a new project

  Options:
    --help                 Show this help message
    --version              Show version
`);
}
