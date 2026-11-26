const path = require("node:path");
const Module = require("node:module");
const esbuild = require("esbuild");

const REPO_ROOT = path.resolve(module.path, "..", "..");

/**
 * Bundle a TypeScript module with esbuild and evaluate it as CommonJS, so tests
 * exercise the same code esbuild ships in main.js.
 *
 * The `obsidian` module does not exist in Node. It is replaced with a stub whose
 * requestUrl delegates to globalThis.__testRequestUrl, which the test defines.
 */
async function loadTypeScript(relativePath) {
	const absolutePath = path.resolve(REPO_ROOT, relativePath);
	const result = await esbuild.build({
		entryPoints: [absolutePath],
		bundle: true,
		platform: "node",
		format: "cjs",
		write: false,
		logLevel: "silent",
		plugins: [
			{
				name: "test-obsidian-stub",
				setup(build) {
					build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian", namespace: "test-stub" }));
					build.onLoad({ filter: /.*/, namespace: "test-stub" }, () => ({
						contents: "export const requestUrl = (options) => globalThis.__testRequestUrl(options);",
						loader: "js",
					}));
				},
			},
		],
	});

	const loaded = new Module(absolutePath, module);
	loaded.filename = absolutePath;
	loaded.paths = module.paths;
	loaded._compile(result.outputFiles[0].text, absolutePath);
	return loaded.exports;
}

module.exports = { loadTypeScript };
