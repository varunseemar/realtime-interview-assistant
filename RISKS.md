# Top 3 risks of taking this POC to production

**1. Latency and reliability depend on third parties.** The loop chains two external streaming services, Deepgram and Groq, on free tiers with queueing, rate limits and outages. In testing, Groq's time to first token varied from 0.3 to 0.9 s, and Deepgram held back final transcripts for up to 5 s until I forced them. An answer that arrives late is effectively a failed one.
*Mitigation:*
- Use paid tiers with SLAs, deployed in the same region as the providers.
- Put a fallback provider behind the existing STT and LLM interfaces, with circuit breakers.
- Reconnect automatically and buffer audio (PCM, not webm) so dropped streams don't lose words.
- Monitor p95 end-to-end latency per stage and alert on it.

**2. Cost growth and abuse.** Speech-to-text is billed per audio minute and the app streams continuously, silence included. Every utterance can trigger an LLM call, and speculative classification deliberately makes extra ones. With no accounts or per-user limits, a tab left shared all day, or a script hitting the endpoint, gets expensive quickly.
*Mitigation:*
- Stream audio to speech-to-text only while the browser's voice-activity detector hears speech.
- Add accounts with per-user quotas and rate limits.
- Track cost per interview-minute, with budget alerts.
- Cap speculative classifier calls.

**3. Scaling a stateful real-time server.** Each session lives in one Node process's memory: the Deepgram connection, detector state and conversation memory. A deploy or crash drops live interviews mid-question, a second instance needs sticky routing, and every user holds an open vendor connection, so capacity is limited by the vendor as well as our servers.
*Mitigation:*
- Sticky load balancing and graceful draining on deploy.
- Keep session context in Redis so a reconnecting client resumes on any instance.
- Autoscale on concurrent connections, not CPU.
- Agree concurrency limits with vendors and load-test against them.
