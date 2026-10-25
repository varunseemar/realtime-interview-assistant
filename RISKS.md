# Top 3 risks of taking this POC to production

**1. Answers that misrepresent the candidate.** The model still sometimes invents plausible details, such as a metric in a behavioral story. One invented claim that gets probed in a follow-up hurts the user more than no answer at all. Detection mistakes add to this: answering small talk distracts, and missing a question makes the product feel broken.
*Mitigation:* gate every prompt, model or threshold change on a labelled set of real interview recordings, measuring detection accuracy, misses and unsupported claims. Extract resume facts into a structured list, require answers to cite them, and flag unsupported sentences in the UI.

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
