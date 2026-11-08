"""Race real FK inserts/deletion on the disposable LOCAL fixture in the ledger guide."""
import os
import subprocess
import time
import uuid


PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1", "-p", "55432", "-d", "hyper_ledger_test"]


def sql(statement):
    return subprocess.check_output(PSQL + ["-c", statement], text=True).strip()


def race(delete_first, rollback=False):
    user = str(uuid.uuid4())
    name = "ledger_race_" + uuid.uuid4().hex
    insert = f"INSERT INTO public.food_analysis_ledger VALUES ('food-v1/{user}/2026-11-08/results/0.json', '{user}', '{{}}');"
    delete = f"DELETE FROM auth.users WHERE id = '{user}';"
    sql(f"INSERT INTO auth.users(id) VALUES ('{user}');")
    first = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    second = None
    try:
        first.stdin.write("BEGIN;\n" + (delete if delete_first else insert) + "\n\\echo LOCKED\n")
        first.stdin.flush()
        assert first.stdout.readline().strip() == "LOCKED"
        second = subprocess.Popen(
            PSQL + ["-c", insert if delete_first else delete],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            env={**os.environ, "PGAPPNAME": name},
        )
        # Wait for evidence that the second transaction is blocked on the FK,
        # not for a guessed sleep long enough for a query to start.
        deadline = time.monotonic() + 10
        while sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name = '{name}' AND wait_event_type = 'Lock'") != "1":
            if second.poll() is not None or time.monotonic() >= deadline:
                raise AssertionError("Second transaction did not block on the foreign key")
        first.stdin.write(("ROLLBACK;" if rollback else "COMMIT;") + "\n\\q\n")
        first.stdin.flush()
        first.communicate(timeout=10)
        assert first.returncode == 0
        _, error = second.communicate(timeout=10)
        if delete_first and not rollback:
            assert second.returncode != 0 and "foreign key constraint" in error, error
        else:
            assert second.returncode == 0, error
        count = sql(f"SELECT count(*) FROM public.food_analysis_ledger WHERE user_id = '{user}'")
        assert count == ("1" if rollback else "0"), count
        print(f"PASS delete_first={delete_first}, rollback={rollback}")
    finally:
        if first.poll() is None:
            first.terminate()
            first.communicate(timeout=10)
        if second is not None and second.poll() is None:
            second.terminate()
            second.communicate(timeout=10)
        sql(delete)


race(delete_first=False)
race(delete_first=True)
race(delete_first=True, rollback=True)
