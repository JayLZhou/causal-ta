import subprocess
import sys
import unittest

from tools.check_install import wait_for_server


class InstallMonitorTests(unittest.TestCase):
    def start(self, script):
        process=subprocess.Popen([sys.executable,'-u','-c',script],stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE,text=True,encoding='utf-8')
        def cleanup():
            if process.poll() is None:process.terminate()
            process.wait(timeout=5)
            process.stdout.close();process.stderr.close()
        self.addCleanup(cleanup)
        return process

    def test_delayed_readiness_and_stderr_are_drained(self):
        process=self.start("import sys,time; print('x'*100000,file=sys.stderr); time.sleep(.1); print('CausalTA：http://127.0.0.1:9876（Ctrl+C 停止）'); time.sleep(2)")
        self.assertEqual(wait_for_server(process,timeout=3),'http://127.0.0.1:9876')
        self.assertIsNone(process.poll())

    def test_early_exit_reports_diagnostic(self):
        process=self.start("import sys; print('synthetic startup error',file=sys.stderr); sys.exit(7)")
        with self.assertRaisesRegex(RuntimeError,'exit=7.*synthetic startup error'):
            wait_for_server(process,timeout=3)

    def test_timeout_does_not_mistake_running_process_for_exited(self):
        process=self.start('import time; time.sleep(3)')
        with self.assertRaisesRegex(RuntimeError,'未报告就绪.*exit=None'):
            wait_for_server(process,timeout=.1)
        self.assertIsNone(process.poll())


if __name__=='__main__':unittest.main()
