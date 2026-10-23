const MAX_CHARS = 12_000; // matches the server-side cap per field

function ContextField({ id, label, hint, value, onChange }) {
  return (
    <div className="context-field">
      <label htmlFor={id} className="context-label">
        {label}
        <span className="char-count">
          {value.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </label>
      <textarea
        id={id}
        value={value}
        maxLength={MAX_CHARS}
        placeholder={hint}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

export function ContextForm({ context, onChange, running, onClose }) {
  const update = (field) => (value) => onChange({ ...context, [field]: value });

  return (
    <section className="panel context-panel" aria-label="Interview context">
      <div className="context-header">
        <h2 className="panel-title">Your context</h2>
        <p className="context-note">
          Answers are grounded in this. Saved in this browser only.
          {running && <strong> Changes apply the next time you press Start.</strong>}
        </p>
        <button type="button" className="btn btn-ghost" onClick={onClose}>
          Done
        </button>
      </div>
      <div className="context-grid">
        <ContextField
          id="resume"
          label="Resume / summary"
          hint="Paste your resume or a short summary of your experience…"
          value={context.resume}
          onChange={update('resume')}
        />
        <ContextField
          id="jd"
          label="Job description"
          hint="Paste the job description for the role you're interviewing for…"
          value={context.jd}
          onChange={update('jd')}
        />
      </div>
    </section>
  );
}
