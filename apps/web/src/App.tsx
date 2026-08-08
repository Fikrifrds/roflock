import { useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell.js';
import { Section } from './components/primitives.js';
import { useData } from './lib/client.js';
import { Approvals } from './routes/Approvals.js';
import { Evidence } from './routes/Evidence.js';
import { Home } from './routes/Home.js';
import { Knowledge } from './routes/Knowledge.js';
import { NewTask } from './routes/NewTask.js';
import { Privacy } from './routes/Privacy.js';
import { Projects } from './routes/Projects.js';
import { Providers } from './routes/Providers.js';
import { Roles } from './routes/Roles.js';
import { TaskDetail } from './routes/TaskDetail.js';

const PRIVACY_KEY = 'roleflock-privacy-accepted';

const FALLBACK_CLAIMS = [
  'Daemon binds to 127.0.0.1 by default.',
  'Exports redact API keys and tokens.',
  'Update checks do not send repository contents.',
];

export function App() {
  const [privacyAccepted, setPrivacyAccepted] = useState(
    () => localStorage.getItem(PRIVACY_KEY) === '1',
  );
  const { data: privacy } = useData<{ claims: string[] }>(
    ['privacy-onboarding'],
    '/api/privacy',
    !privacyAccepted,
  );

  if (!privacyAccepted) {
    return (
      <Shell>
        <Section title="Before you start">
          <p className="lede">
            Roflock stays on your machine. Confirm these points, then add a project and create a
            task.
          </p>
          <ul className="claim-list">
            {(privacy?.claims ?? FALLBACK_CLAIMS).map((claim) => (
              <li key={claim}>{claim}</li>
            ))}
          </ul>
          <div className="form-actions">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem(PRIVACY_KEY, '1');
                setPrivacyAccepted(true);
              }}
            >
              Continue
            </button>
          </div>
        </Section>
      </Shell>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/projects" element={<Projects />} />
      <Route path="/tasks/new" element={<NewTask />} />
      <Route path="/tasks/:id" element={<TaskDetail />} />
      <Route path="/tasks/:id/evidence" element={<Evidence />} />
      <Route path="/approvals" element={<Approvals />} />
      <Route path="/knowledge" element={<Knowledge />} />
      <Route path="/providers" element={<Providers />} />
      <Route path="/roles" element={<Roles />} />
      <Route path="/privacy" element={<Privacy />} />
    </Routes>
  );
}
