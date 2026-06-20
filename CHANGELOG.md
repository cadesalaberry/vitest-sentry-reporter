# Changelog

## [1.4.0](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.3.0...v1.4.0) (2026-06-20)


### ✨ Features

* **reporter:** ✨ relativize test_file and surface CI links and project ([#35](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/35)) ([673f27b](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/673f27bd274914e51f802da8675542386d2b2d3c))

## [1.3.0](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.2.0...v1.3.0) (2026-06-18)


### ✨ Features

* **reporter:** ✨ surface the CI run URL on reported failures ([#33](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/33)) ([e7f2f13](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/e7f2f13d73efb005067b6faa1d9f872306630e93))

## [1.2.0](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.1.1...v1.2.0) (2026-06-11)


### ✨ Features

* **reporter:** ✨ resolve CODEOWNERS into code_owners/code_owner tags ([3367877](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/3367877e528d390e2250538f419a2163b52aca17))
* **reporter:** resolve CODEOWNERS into code_owners/code_owner tags ([#30](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/30)) ([3367877](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/3367877e528d390e2250538f419a2163b52aca17))

## [1.1.1](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.1.0...v1.1.1) (2026-06-10)


### 🐛 Bug Fixes

* **reporter:** 🐛 round durationMs to an integer before reporting to Sentry ([#28](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/28)) ([42bbf84](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/42bbf84ed48e86d249d94c9e3845c029994e5aeb))

## [1.1.0](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.0.3...v1.1.0) (2026-06-10)


### ✨ Features

* **reporter:** ✨ tag failures with run trigger and actor detection ([#25](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/25)) ([addbc7f](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/addbc7fae560e94cdeea755f5c50ac9099764fc5))

## [1.0.3](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.0.2...v1.0.3) (2026-06-09)


### 🐛 Bug Fixes

* **release:** 🐛 enforce frozen lockfile in CI to unblock npm publish ([#23](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/23)) ([b8e16db](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/b8e16dbed7106c1c0a6ee0885b3b7209858a5a2b))

## [1.0.2](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.0.1...v1.0.2) (2026-06-09)


### 📦️ Build System

* publish only useful files in the npm package ([#10](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/10)) ([0651dd7](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/0651dd71f937c837792494a0fb254278364780c2))


### 👷 Continuous Integration

* bump actions/checkout from 4 to 6 ([#13](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/13)) ([f4549fb](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/f4549fb2dbfc1af0baf624cf3615326bace7ee78))
* bump actions/setup-node from 4 to 6 ([#18](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/18)) ([6da9690](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/6da9690018193c70251b0b019900566908507f54))
* bump codecov/codecov-action from 5 to 7 ([#14](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/14)) ([c9a3616](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/c9a361635275ed2c5c2fda3247748f0c454a1139))
* bump googleapis/release-please-action from 4 to 5 ([#17](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/17)) ([081cbf6](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/081cbf62b26a6db6bd45b7b37246a207cb169c9d))
* bump oven-sh/setup-bun from 1 to 2 ([#16](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/16)) ([4f8a0f6](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/4f8a0f659c9fb70d4421a8192da135da04e1b972))
* **release:** 🔐 publish to npm via OIDC trusted publishing ([#15](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/15)) ([6122f35](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/6122f35d29ecf788b8844c73e8d0975c1c144b65))
* skip Codecov upload on Dependabot PRs ([#21](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/21)) ([04c36e1](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/04c36e14738b74cebc7d92862bd6caa673f4ccb3))

## [1.0.1](https://github.com/cadesalaberry/vitest-sentry-reporter/compare/v1.0.0...v1.0.1) (2026-06-09)


### 📝 Documentation

* **adr:** 📝 reorder ADRs and unify front-matter structure ([#8](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/8)) ([76c6455](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/76c6455ce73b172a7f04878af2578baf38b65036))


### 👷 Continuous Integration

* **release:** 👷 add release-please auto-versioning and npm publish ([#7](https://github.com/cadesalaberry/vitest-sentry-reporter/issues/7)) ([d365cf9](https://github.com/cadesalaberry/vitest-sentry-reporter/commit/d365cf90e088742f2cdb972ae39b8346d3efbbe1))
