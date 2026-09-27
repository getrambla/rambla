# iOS TestFlight Build Speed — Research Findings (4 agents, 2026-09-27)

Researchers were spawned before the workflow rewrite. Their raw reports are
reconstructed here verbatim from their final messages (this file was written
after the fact; the researchers themselves wrote no files). Where a claim was
later disproven by testing, a TESTED note is appended.

---

## Agent 1: Fastlane speed

1. `skip_waiting_for_build_processing: true` skips only the post-upload
   polling loop; upload itself unaffected. It is the official CI
   recommendation, BUT Tom rejected it: it does not make the build reach
   testers sooner, only turns the workflow green earlier. The lane stays
   `false` per Tom's standing documented decision. Do not change it again.
2. No faster upload mechanism exists: App Store Connect API does not accept
   binary uploads; altool is deprecated; Transporter CLI is the same
   iTMSTransporter engine pilot uses. Do not churn the upload mechanism.
3. gym options that matter:
   - `xcodebuild_formatter: "xcbeautify"` explicitly — fastlane can silently
     fall back to xcpretty on some versions, slow on 10k+-line logs.
   - `skip_package_dependencies_resolution: true` — pod install already ran
     as its own cached step.
   - `export_options: { thinning: "<none>" }` — Apple re-thins server-side
     for TestFlight; local thinning variants are waste.
   - `include_symbols: true` only affects export options; the real dSYM cost
     is dwarf-with-dsym during archive.
   Sources: docs.fastlane.tools/actions/pilot, /actions/build_app,
   /best-practices/xcodebuild-formatters, fastlane#22105.

## Agent 2: CocoaPods speed

1. Do not run `pod install --repo-update` in CI; Podfile.lock already pins.
   Best practice is `bundle exec pod install` —
   **TESTED: DOES NOT APPLY HERE.** CocoaPods is not in this repo's Gemfile
   (only fastlane + multi_json), so `bundle exec pod install` fails with
   Bundler::GemNotFound. CI broke; reverted to plain `pod install`.
2. Cache both `ios/Pods` + `~/Library/Caches/CocoaPods`. Cache SAVES are
   branch-isolated on GitHub (only default-branch saves are shared);
   restores work on every branch. Recommendation was main-only saves via
   weekly warm-up run — **Tom rejected branch-scoping: saves now run on
   every branch, no branch/ref conditions in the workflow.**
3. Known RN nondeterminism #56975/#54891 (RN 0.83–0.85): with
   RCT_USE_PREBUILT_RNCORE=1, SPEC CHECKSUMS for hermes-engine/Yoga/
   ReactNativeDependencies differ run-to-run, so Podfile.lock-hash cache
   keys can miss. This repo is RN 0.81.5 (predates the buggy range) but
   re-check on any RN upgrade.
4. Expo SDK 56 ships precompiled XCFrameworks for Expo modules AND
   third-party libs (~-65% clean build). This repo is SDK 54 — upgrade is
   the biggest future lever.
5. SPM: RN 0.87 experimental, not production-safe; not applicable on
   Expo prebuild today.

## Agent 3: RN CI strategy

1. No upstream prebuilt-third-party-pods mechanism ships yet (Reanimated,
   Worklets, Screens, SVG have no official xcframeworks). RCT core prebuilt
   (RCT_USE_PREBUILT_RNCORE=1) already covers RN core + Hermes; the ~770
   third-party compile units need caching.
2. Warm DerivedData incremental cache with nanosecond-mtime restore
   (irgaly/xcode-cache pattern) is the single biggest lever: archive
   21 min → 4–8 min on hits; composes with ccache. Caveat: incremental,
   not content-addressed; multi-GB cache size brushes the 10 GB limit.
   NOT yet implemented here — ccache only, first.
3. Committing ios/ buys ~nothing; don't.
4. gym is a thin wrapper — raw xcodebuild saves seconds, not minutes.
5. Runner reality: standard macos GitHub runners are 3–4 core M-series;
   true cold build floor is ~15 min. 10–15 min totals are cache-hit
   medians, not p99. Guaranteed sub-15 needs larger runners (~3x cost) or
   self-hosted Mac mini.

## Agent 4: Xcode archive speed

1. Runner: macos-26 arm64 = 3-core M1, 7 GB RAM. `-jobs`/`-parallelizeTargets`
   tuning is pointless; CPU-starved. "Never compile what you can link."
2. Per-pod prebuilt verdicts: Reanimated/Worklets prebuilt via Expo
   (SDK 56+, see Agent 2); ZXingObjC (163 units, biggest single pod, comes
   from expo-camera's podspec `ZXingObjC/PDF417` + `/OneD`) has NO prebuilt
   — alternatives are GoogleMLKit/BarcodeScanning or dropping barcode
   support (product decision); libwebp/libdav1d come via SDWebImage coders,
   no prebuilt, ccache targets.
3. ccache config (from ccache 4.x manual) — all applied in the workflow:
   - sloppiness MUST include `modules` or ccache refuses -fmodules compiles
     (all pods use them); also clang_index_store, ivfsoverlay, pch_defines,
     include_file_ctime/mtime, file_stat_macros, system_headers, time_macros.
   - depend_mode AND direct_mode both required with modules.
   - compiler_check=content (image Xcode patches change mtime);
     base_dir=/Users/runner; max_size=8G.
   - Verify hit rates with `ccache -s` after first runs; CCACHE_DEBUG if
     "Unsupported compiler option" spikes.
4. xcodebuild flags ranked: COMPILER_INDEX_STORE_ENABLE=NO (applied);
   ARCHS=arm64 ONLY_ACTIVE_ARCH=NO (applied); pod-target
   DEBUG_INFORMATION_FORMAT=dwarf (NOT applied — verify symbolication
   consumers first); SWIFT_COMPILATION_MODE changes unsafe; dead-code
   stripping negligible.
5. expo-dev-launcher/dev-menu compile into Release because expo-dev-client
   is in package.json unconditionally; inert at runtime but costs build
   time. Exclusion would need expo autolinking exclude — not done.
6. Realistic combined target: 21 min archive → ~6–9 min on 3-core hosted
   runner with prebuilts + ccache warm.

---

## What is actually in the workflow now (branch fix-ios-testflight-workflow)

- Weekly scheduled run on main (uploads nothing) — cache warm-up.
- ccache with the config above, shims via RAMBLA_CC/RAMBLA_CXX env, consumed
  by Fastfile xcargs CC=/CXX=.
- Restore ccache / Restore CocoaPods cache before build; Save ccache /
  Save CocoaPods cache after build. Keys: runner.os + hash(package-lock.json,
  packages/app/app.config.js). No branch in keys; no branch conditions on
  steps. Save steps skipped on clean_build.
- pod install PLAIN (not bundle exec). Fastfile: xcargs CC/CXX/INDEX_STORE/
  ARCHS=arm64; gym xcodebuild_formatter=xcbeautify,
  skip_package_dependencies_resolution, thinning <none>.
- skip_waiting_for_build_processing remains false (Tom's standing decision).
- Removed vs main: the DerivedData cache step (never hit across branches, and
  cost ~3 min save per run).
