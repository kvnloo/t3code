import importlib.util
from pathlib import Path
import stat
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("k3s_p0_render", ROOT / "render.py")
assert spec and spec.loader
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)

class TestSafeRenderOutput(unittest.TestCase):
    def test_output_is_complete_private_and_exclusive(self):
        with tempfile.TemporaryDirectory() as root:
            out = Path(root) / 'out.yaml'
            render.write_new_output(out, 'hello\n')
            self.assertEqual(out.read_text(), 'hello\n')
            self.assertEqual(stat.S_IMODE(out.stat().st_mode), 0o600)
            with self.assertRaises(FileExistsError):
                render.write_new_output(out, 'unsafe replacement')
            self.assertEqual(out.read_text(), 'hello\n')
            self.assertEqual(set(Path(root).iterdir()), {out})

    def test_symlink_does_not_clobber_target(self):
        with tempfile.TemporaryDirectory() as root:
            target = Path(root) / 'precious.txt'
            target.write_text('user data')
            link = Path(root) / 'output.yaml'
            link.symlink_to(target)
            with self.assertRaises(FileExistsError):
                render.write_new_output(link, 'malicious data')
            self.assertEqual(target.read_text(), 'user data')
            self.assertTrue(link.is_symlink())
            self.assertFalse(any(Path(root).glob('.*.tmp')))

    def test_publish_failure_cleans_staging_without_output(self):
        with tempfile.TemporaryDirectory() as root:
            out = Path(root) / 'output.yaml'
            with mock.patch.object(render.os, 'link', side_effect=OSError('link unavailable')):
                with self.assertRaises(OSError):
                    render.write_new_output(out, 'incomplete')
            self.assertFalse(out.exists())
            self.assertEqual(list(Path(root).iterdir()), [])

if __name__ == '__main__':
    unittest.main()
