"""Race many real claims against the daily AI budget on a disposable LOCAL Supabase database.

Needs 20261111120000_public_signup_hardening.sql applied. Each claim runs in its
own psql connection at the same moment. However they interleave, the day's
committed total (open reservations plus settled costs) must never pass the
budget, so the money spent can only pass it if one request costs more than its
own reservation. Restores app_config and removes its fixtures afterwards.

    HYPER_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
      python3 tests/sql/aiBudgetRace.py
"""
import os
import random
import subprocess
from concurrent.futures import ThreadPoolExecutor

URL = os.environ.get("HYPER_TEST_DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54322/postgres")
PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", URL]
DATE = "1999-12-31"
BUDGET_MICROS = 1_000_000  # $1.00


def sql(statement):
    return subprocess.check_output(PSQL + ["-c", statement], text=True).strip()


def claim(key, reserve):
    return sql(f"SET ROLE service_role; SELECT public.claim_ai_spend('{key}', NULL, 'food-analysis', '{DATE}', {reserve});").splitlines()[-1]


def settle(key, cost):
    return sql(f"SET ROLE service_role; SELECT public.settle_ai_spend('{key}', {cost});").splitlines()[-1]


def committed():
    return int(sql(f"SELECT coalesce((SELECT committed_micros FROM public.ai_spend_daily WHERE usage_date = '{DATE}'), 0)"))


def cleanup():
    sql(f"DELETE FROM public.ai_spend_claims WHERE usage_date = '{DATE}'; DELETE FROM public.ai_spend_daily WHERE usage_date = '{DATE}';")


saved = sql("SELECT ai_enabled || ',' || ai_daily_budget_usd FROM public.app_config WHERE id")
cleanup()
sql("UPDATE public.app_config SET ai_enabled = TRUE, ai_daily_budget_usd = 1.00")
try:
    # 1. Forty $0.30 reservations at once: exactly three fit in $1.00.
    with ThreadPoolExecutor(max_workers=40) as pool:
        outcomes = list(pool.map(lambda i: claim(f"race-{i}", 300_000), range(40)))
    assert outcomes.count("claimed") == 3, outcomes
    assert outcomes.count("exhausted") == 37, outcomes
    assert committed() == 900_000, committed()

    # 2. Settling and claiming at the same time, with costs at or under each
    #    reservation: the total never passes the budget at any point.
    winners = [f"race-{i}" for i, outcome in enumerate(outcomes) if outcome == "claimed"]
    jobs = [("settle", key, random.randint(0, 300_000)) for key in winners]
    jobs += [("claim", f"race-more-{i}", random.choice([50_000, 100_000, 300_000])) for i in range(60)]
    random.shuffle(jobs)
    with ThreadPoolExecutor(max_workers=30) as pool:
        list(pool.map(lambda job: settle(job[1], job[2]) if job[0] == "settle" else claim(job[1], job[2]), jobs))
    total = committed()
    assert total <= BUDGET_MICROS, f"committed {total} passed the budget {BUDGET_MICROS}"
    # The day row agrees with the claims behind it.
    recount = int(sql(f"SELECT coalesce(sum(coalesce(cost_micros, reserved_micros)), 0) FROM public.ai_spend_claims WHERE usage_date = '{DATE}'"))
    assert recount == total, (recount, total)
    print(f"ok: 40 + {len(jobs)} concurrent calls, committed ${total / 1e6:.2f} of ${BUDGET_MICROS / 1e6:.2f}")
finally:
    enabled, budget = saved.split(",")
    sql(f"UPDATE public.app_config SET ai_enabled = {enabled}, ai_daily_budget_usd = {budget}")
    cleanup()
