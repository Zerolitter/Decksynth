"""OBS-1 packaging contracts: optional telemetry remains small and sandbox-safe."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class ObservabilityPackagingTests(unittest.TestCase):
    def test_observability_lock_uses_minimal_explicit_packages_and_hashes(self):
        lock = (ROOT / 'requirements-observability.lock').read_text()
        self.assertNotIn('dash0-opentelemetry==', lock)
        self.assertIn('opentelemetry-api==', lock)
        self.assertIn('opentelemetry-sdk==', lock)
        self.assertIn('dash0-opentelemetry-exporter-otlp-pyproto-http==', lock)
        self.assertIn('--hash=sha256:', lock)

    def test_retained_local_flatpak_does_not_gain_network_permission(self):
        manifest = (ROOT / 'packaging/flatpak/io.github.zerolitter.Decksynth.yml').read_text()
        self.assertNotIn('  - --share=network\n', manifest)

    def test_release_bundle_keeps_observability_dependencies_private(self):
        release = (ROOT / 'packaging/release/build-release.sh').read_text()
        launcher = (ROOT / 'launch.sh').read_text()
        workflow = (ROOT / '.github/workflows/release.yml').read_text()
        self.assertIn('requirements-observability.lock', release)
        self.assertIn('docs/OBSERVABILITY.md', release)
        self.assertNotIn('DASH0_AUTH_TOKEN', release)
        self.assertIn('DECKSYNTH_OBSERVABILITY_PYTHONPATH', launcher)
        self.assertIn('actions/setup-python@', workflow)
        self.assertIn("python-version: '3.13'", workflow)


class ObservabilityDocumentationTests(unittest.TestCase):
    def test_observability_docs_include_github_release_and_flatpak_opt_in(self):
        doc = (ROOT / 'docs/OBSERVABILITY.md').read_text()
        self.assertIn('GitHub Releases', doc)
        self.assertIn('DASH0_ENABLED=true', doc)
        self.assertIn('flatpak override --user --share=network io.github.zerolitter.Decksynth', doc)
        self.assertIn('flatpak override --user --reset io.github.zerolitter.Decksynth', doc)
        self.assertIn('general network access', doc)
        self.assertIn('not a Flathub submission target', doc)


if __name__ == '__main__':
    unittest.main()
