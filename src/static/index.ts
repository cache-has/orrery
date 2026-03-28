/**
 * Static export engine.
 *
 * Renders dashboards to self-contained static HTML files that can be
 * hosted on any static file server or shared as standalone files.
 */

export { staticBuild, type StaticBuildOptions, type StaticBuildResult } from "./builder.js";
export { renderStaticPage, renderStaticIndex, type StaticRenderOptions, type StaticIndexDashboard } from "./renderer.js";
