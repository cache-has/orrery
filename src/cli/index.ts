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
  Orrery — Dashboards as code, not clicks.

  Usage:
    orrery dev          Start dev server with hot reload
    orrery serve        Start production HTTP server (no watcher/hot reload)
    orrery build        Export static HTML dashboards
    orrery validate     Validate .board files and connections
    orrery diff         Compare dashboards between git refs
    orrery create       Scaffold a new project

  Options:
    --help                 Show this help message
    --version              Show version
`);
}
