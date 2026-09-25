---
name: Background timers on an autoscale deployment
description: Why the recurring mail poller stalls and collides with itself in production, and what evidence distinguishes it from a hung API call.
---

The app's recurring work (mail polling) is a bare `setInterval` inside the web process, and the deployment target is autoscale. Two consequences that look like bugs elsewhere:

**1. Silent dead windows, not hangs.** Autoscale suspends the instance when no requests arrive, so the timer simply does not fire while nobody is using the app; it resumes on the next request or publish. The signature is *repeated* gaps of 10-50 minutes scattered through the day that each clear themselves. A genuine hang does not recur a dozen times a day and recover without intervention. Diagnose by listing gaps between consecutive row `created_at` values for the job's output table before concluding anything about the API being called.

**Why:** a stall that coincided with a deploy was nearly attributed to a hung Gmail call; timeouts would have been added to suppress a symptom that was really the scheduler not running at all.

**2. Overlapping runs, because the interval is unconditional.** When one cycle takes longer than the interval, the next one starts anyway, and autoscale can add instances that each carry their own timer. Overlapping runs of a resume-by-cursor job are especially damaging: every copy reads the same cursor (the row only updates when a run completes), so they all re-walk the same window, and any check-then-insert dedupe races into unique-constraint violations.

**How to apply:** treat a duplicate-key error on a job with a pre-insert existence check as *proof of concurrency*, not as a harmless caught error — a single-threaded run cannot produce it. Fix with a cross-process single-flight guard (advisory lock or claimed-at row, since an in-process boolean does not cover multiple instances), per-page cursor advancement so a long run still makes progress, and conflict-tolerant inserts. Moving recurring work off the web process (scheduled deployment or VM target) is the separate fix for point 1, and it needs the guard from point 2 in place first.
