# Top 3 risks of taking this POC to production

**1. Answers that misrepresent the candidate.** The model still sometimes invents plausible details, such as a metric in a behavioral story. In an interview, one invented claim that gets probed in a follow-up hurts the user more than no answer at all. Detection mistakes add to this: an answer to small talk is a distraction, and a missed question makes the product feel broken.
*Mitigation:* gate every prompt, model or threshold change on a labelled set of real interview recordings, measuring detection accuracy, misses and unsupported claims. Extract resume facts into a structured list, require answers to cite them, and flag unsupported sentences in the UI.

**2. Latency and reliability depend on third parties.** Two external streaming services are chained on free tiers, with queueing, rate limits and outages. An answer that arrives late is effectively a failed one.
*Mitigation:*
- Use paid tiers with SLAs, in the same region as the providers.
- Put a fallback provider behind the existing STT and LLM interfaces, with circuit breakers.
- Reconnect automatically and buffer audio (PCM, not webm) so dropped streams don't lose words.
- Monitor p95 end-to-end latency per stage and alert on it.

**3. Privacy, consent and legal exposure.** The product sends a third party's voice (the interviewer) and the candidate's resume to external processors. Several places require every party to consent to recording, GDPR applies, and some employers treat this kind of assistance as a policy violation.
*Mitigation:*
- Process audio as a stream only and store nothing by default.
- Use vendor zero-retention options and data-processing agreements.
- Encrypt data, add authentication, and keep users' data separate.
- Collect explicit consent and show region-aware notices.
- Get legal review of positioning and terms before launch.
