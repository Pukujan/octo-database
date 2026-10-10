import { ActivityRows, when } from '@/components/shared';
import { apiSend } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import type { OpsSummary } from '@/lib/types';

function FailurePanel({ summary }: { summary: OpsSummary | null }) {
  const { workspace, reload } = useWorkspace();
  const query = `?workspaceId=${encodeURIComponent(workspace?.id ?? '')}`;
  const retry = async (jobId: string) => {
    await apiSend(`/api/jobs/${encodeURIComponent(jobId)}/retry${query}`, 'POST');
    await reload();
  };

  if (!summary) {
    return (
      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">FAILURE ANALYSIS</p>
            <h2>What is failing</h2>
          </div>
        </div>
        <div className="empty-panel compact">
          <strong>No failure data</strong>
          <p>Classified failures appear here once the workspace records errors.</p>
        </div>
      </section>
    );
  }

  const counts = summary.failureCounts;
  const byDay = summary.failuresByJobTypeDay;
  const unhealthy = summary.unhealthyJobs;

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <p className="eyebrow">FAILURE ANALYSIS</p>
          <h2>What is failing</h2>
          <p className="panel-copy">
            Failures classified by error code, by job type and day, and the jobs currently needing attention.
          </p>
        </div>
      </div>

      <h3 className="subhead">By error code</h3>
      {counts.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Error code</th>
                <th>Source</th>
                <th>Events</th>
                <th>Last seen</th>
              </tr>
            </thead>
            <tbody>
              {counts.map((row, index) => (
                <tr key={`${row.errorCode ?? 'unclassified'}-${index}`}>
                  <td>
                    <strong>{row.errorCode ?? 'Unclassified'}</strong>
                    <small>{row.severity}</small>
                  </td>
                  <td>{row.source}</td>
                  <td>{row.eventCount}</td>
                  <td>{when(row.lastSeen)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-panel compact">
          <strong>No classified failures</strong>
          <p>Nothing has been recorded against this workspace.</p>
        </div>
      )}

      <h3 className="subhead">By job type and day</h3>
      {byDay.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Day</th>
                <th>Job type</th>
                <th>Error code</th>
                <th>Events</th>
              </tr>
            </thead>
            <tbody>
              {byDay.map((row, index) => (
                <tr key={`${row.day}-${row.jobType}-${index}`}>
                  <td>{row.day}</td>
                  <td>
                    <strong>{row.jobType}</strong>
                  </td>
                  <td>{row.errorCode ?? '—'}</td>
                  <td>{row.eventCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-panel compact">
          <strong>No daily failures</strong>
          <p>No failures were recorded on any day.</p>
        </div>
      )}

      <h3 className="subhead">Jobs needing attention</h3>
      {unhealthy.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Job</th>
                <th>State</th>
                <th>Attempts</th>
                <th>Last update</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {unhealthy.map((row) => (
                <tr key={row.jobId}>
                  <td>
                    <strong>{row.jobType}</strong>
                    {row.errorCode ? <small className="error-detail">{row.errorCode}</small> : null}
                  </td>
                  <td>
                    <span className={`state-pill state-${row.state}`}>{row.state}</span>
                  </td>
                  <td>
                    {row.attempt} / {row.maxAttempts}
                  </td>
                  <td>{when(row.updatedAt)}</td>
                  <td>
                    {row.state === 'failed' ? (
                      <button className="text-button" data-action="retry" data-id={row.jobId} onClick={() => void retry(row.jobId)}>
                        Retry
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty-panel compact">
          <strong>No unhealthy jobs</strong>
          <p>Every job is either done, queued, or holding a live lease.</p>
        </div>
      )}
    </section>
  );
}

export default function Operations() {
  const { jobs, activity, opsSummary, workspace, reload } = useWorkspace();
  const queued = jobs.filter((job) => job.state === 'queued').length;
  const failed = jobs.filter((job) => job.state === 'failed').length;
  const query = `?workspaceId=${encodeURIComponent(workspace?.id ?? '')}`;

  const retry = async (id: string) => {
    await apiSend(`/api/jobs/${encodeURIComponent(id)}/retry${query}`, 'POST');
    await reload();
  };

  return (
    <div data-testid="view-operations">
      <div className="metric-grid metric-grid-three">
        <article className="metric-card">
          <span className="metric-label">Queued:</span>
          <strong>{queued}</strong>
          <small>Waiting for a worker</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Failed:</span>
          <strong className={failed ? 'metric-warning' : ''}>{failed}</strong>
          <small>May need another try</small>
        </article>
        <article className="metric-card">
          <span className="metric-label">Recent jobs</span>
          <strong>{jobs.length}</strong>
          <small>Latest workspace records</small>
        </article>
      </div>

      <FailurePanel summary={opsSummary} />

      <section className="panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">WORKSPACE QUEUE</p>
            <h2>Operations</h2>
            <p className="panel-copy">Review processing and retry failed work.</p>
          </div>
          <button
            className="button primary"
            data-action="run-worker"
            type="button"
            onClick={async () => {
              await apiSend(`/api/jobs/run${query}`, 'POST');
              await reload();
            }}
          >
            Run worker pass
          </button>
        </div>
        {jobs.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Job</th>
                  <th>State</th>
                  <th>Attempts</th>
                  <th>Created</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <strong>{job.jobType}</strong>
                      {job.errorSummary ? <small className="error-detail">{job.errorSummary}</small> : null}
                    </td>
                    <td>
                      <span className={`state-pill state-${job.state}`}>{job.state}</span>
                    </td>
                    <td>
                      {job.attempts} / {job.maxAttempts}
                    </td>
                    <td>{when(job.createdAt)}</td>
                    <td>
                      {job.state === 'failed' ? (
                        <button className="text-button" data-action="retry" data-id={job.id} onClick={() => void retry(job.id)}>
                          Retry
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-panel compact">
            <strong>No recent jobs</strong>
            <p>File processing jobs will appear here.</p>
          </div>
        )}
      </section>

      <section className="panel activity-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">EVENT LOG</p>
            <h2>Recent activity</h2>
          </div>
        </div>
        <ActivityRows items={activity} />
      </section>
    </div>
  );
}
