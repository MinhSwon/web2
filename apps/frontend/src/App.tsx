import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, Asset, Job, Project, streamJob, User } from "./api";

type ProjectDetail = { project: Project; assets: Asset[]; jobs: Job[] };

function errorText(error: unknown) {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      EMAIL_EXISTS: "Email này đã được sử dụng.",
      INVALID_CREDENTIALS: "Email hoặc mật khẩu chưa đúng.",
      INSUFFICIENT_CREDITS: "Bạn không còn credit để render.",
      PROJECT_HAS_NO_ASSETS: "Hãy tải lên ít nhất một ảnh.",
      VALIDATION_ERROR: "Dữ liệu chưa hợp lệ.",
    };
    return messages[error.code] ?? error.code;
  }
  return error instanceof Error ? error.message : "Có lỗi xảy ra.";
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem("saas-video-token") ?? "");
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [notice, setNotice] = useState("");

  const loadProjects = useCallback(async () => {
    if (!token) return;
    const data = await api<{ projects: Project[] }>("/api/projects", {}, token);
    setProjects(data.projects);
    setSelectedId((current) => current ?? data.projects[0]?.id ?? null);
  }, [token]);

  const loadDetail = useCallback(async (projectId: string) => {
    const data = await api<ProjectDetail>(`/api/projects/${projectId}`, {}, token);
    setDetail(data);
  }, [token]);

  useEffect(() => {
    if (!token) return;
    Promise.all([api<{ user: User }>("/api/auth/me", {}, token), loadProjects()])
      .then(([me]) => setUser(me.user))
      .catch(() => logout());
  }, [token, loadProjects]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId).catch((error) => setNotice(errorText(error)));
  }, [selectedId, loadDetail]);

  function authenticated(nextToken: string, nextUser: User) {
    localStorage.setItem("saas-video-token", nextToken);
    setToken(nextToken);
    setUser(nextUser);
  }

  function logout() {
    localStorage.removeItem("saas-video-token");
    setToken("");
    setUser(null);
    setProjects([]);
    setDetail(null);
  }

  if (!token || !user) return <AuthScreen onAuthenticated={authenticated} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><span>Frame</span>Foundry</div>
        <div className="account-strip">
          <span className="credit-pill">{user.credits} credits</span>
          <span>{user.display_name}</span>
          <button className="text-button" onClick={logout}>Đăng xuất</button>
        </div>
      </header>

      <main className="workspace">
        <aside className="project-rail">
          <div className="rail-heading">
            <div><span className="eyebrow">Studio</span><h2>Dự án</h2></div>
            <span className="project-count">{projects.length}</span>
          </div>
          <CreateProject token={token} onCreated={async (project) => {
            await loadProjects();
            setSelectedId(project.id);
          }} />
          <div className="project-list">
            {projects.map((project, index) => (
              <button
                className={`project-card ${selectedId === project.id ? "active" : ""}`}
                key={project.id}
                onClick={() => setSelectedId(project.id)}
                style={{ animationDelay: `${index * 70}ms` }}
              >
                <span className="project-index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{project.title}</strong>
                <small>{project.asset_count ?? 0} ảnh · {project.latest_job?.status ?? "DRAFT"}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="editor-stage">
          {notice && <button className="notice" onClick={() => setNotice("")}>{notice}</button>}
          {!detail ? <EmptyState /> : (
            <ProjectEditor
              key={detail.project.id}
              token={token}
              detail={detail}
              onChanged={async () => {
                await Promise.all([loadDetail(detail.project.id), loadProjects()]);
                const me = await api<{ user: User }>("/api/auth/me", {}, token);
                setUser(me.user);
              }}
              onError={(error) => setNotice(errorText(error))}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: (token: string, user: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const body = mode === "register"
        ? { displayName: form.get("displayName"), email: form.get("email"), password: form.get("password") }
        : { email: form.get("email"), password: form.get("password") };
      const data = await api<{ token: string; user: User }>(`/api/auth/${mode}`, { method: "POST", body: JSON.stringify(body) });
      onAuthenticated(data.token, data.user);
    } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
  }

  return (
    <main className="auth-page">
      <section className="auth-story">
        <div className="auth-mark">FF / 26</div>
        <div>
          <span className="eyebrow light">AI video workshop</span>
          <h1>Biến một album ảnh thành một câu chuyện có nhịp điệu.</h1>
          <p>Kịch bản, giọng đọc, phụ đề và chuyển động được điều phối trong một pipeline duy nhất.</p>
        </div>
        <div className="story-steps"><span>01 Story</span><span>02 Voice</span><span>03 Motion</span><span>04 Render</span></div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit} className="auth-form">
          <span className="eyebrow">Bắt đầu</span>
          <h2>{mode === "register" ? "Mở studio của bạn" : "Trở lại studio"}</h2>
          {mode === "register" && <label>Tên hiển thị<input name="displayName" required minLength={2} placeholder="Nguyễn An" /></label>}
          <label>Email<input name="email" type="email" required placeholder="you@example.com" /></label>
          <label>Mật khẩu<input name="password" type="password" required minLength={8} placeholder="Tối thiểu 8 ký tự" /></label>
          {error && <div className="form-error">{error}</div>}
          <button className="primary-button" disabled={busy}>{busy ? "Đang xử lý..." : mode === "register" ? "Tạo tài khoản" : "Đăng nhập"}</button>
          <button type="button" className="text-button auth-switch" onClick={() => setMode(mode === "register" ? "login" : "register")}>
            {mode === "register" ? "Đã có tài khoản? Đăng nhập" : "Chưa có tài khoản? Đăng ký"}
          </button>
        </form>
      </section>
    </main>
  );
}

function CreateProject({ token, onCreated }: { token: string; onCreated: (project: Project) => void }) {
  const [open, setOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const data = await api<{ project: Project }>("/api/projects", {
      method: "POST",
      body: JSON.stringify({ title: form.get("title"), topic: form.get("topic") }),
    }, token);
    setOpen(false); onCreated(data.project);
  }
  if (!open) return <button className="new-project" onClick={() => setOpen(true)}>＋ Dự án mới</button>;
  return (
    <form className="mini-form" onSubmit={submit}>
      <input name="title" required minLength={2} autoFocus placeholder="Tên dự án" />
      <input name="topic" placeholder="Chủ đề" />
      <div><button className="small-button">Tạo</button><button type="button" className="text-button" onClick={() => setOpen(false)}>Hủy</button></div>
    </form>
  );
}

function EmptyState() {
  return <div className="empty-state"><span>✦</span><h2>Tạo dự án đầu tiên</h2><p>Studio sẽ xuất hiện ở đây sau khi bạn tạo một dự án.</p></div>;
}

function ProjectEditor({ token, detail, onChanged, onError }: {
  token: string; detail: ProjectDetail; onChanged: () => Promise<void>; onError: (error: unknown) => void;
}) {
  const latest = detail.jobs[0];
  const [job, setJob] = useState<Job | undefined>(latest);
  const [uploading, setUploading] = useState(false);
  const [rendering, setRendering] = useState(false);

  useEffect(() => setJob(latest), [latest?.id]);
  useEffect(() => {
    if (!job || ["COMPLETED", "FAILED", "CANCELED"].includes(job.status)) return;
    const controller = new AbortController();
    void streamJob(job.id, token, async (next) => {
      setJob(next);
      if (["COMPLETED", "FAILED", "CANCELED"].includes(next.status)) {
        controller.abort();
        await onChanged();
      }
    }, controller.signal).catch((error) => { if (!controller.signal.aborted) onError(error); });
    return () => controller.abort();
  }, [job?.id, job?.status, token]);

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const presign = await api<{ uploadUrl: string; objectKey: string }>("/api/uploads/presign", {
          method: "POST",
          body: JSON.stringify({ projectId: detail.project.id, fileName: file.name, contentType: file.type }),
        }, token);
        const uploaded = await fetch(presign.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!uploaded.ok) throw new Error(`Upload thất bại: ${file.name}`);
        await api(`/api/projects/${detail.project.id}/assets`, {
          method: "POST",
          body: JSON.stringify({ objectKey: presign.objectKey, fileName: file.name, contentType: file.type, sizeBytes: file.size }),
        }, token);
      }
      await onChanged();
    } catch (error) { onError(error); } finally { setUploading(false); }
  }

  async function render(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setRendering(true);
    const form = new FormData(event.currentTarget);
    try {
      const data = await api<{ job: Job }>(`/api/projects/${detail.project.id}/render`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          topic: form.get("topic"), voice: form.get("voice"),
          imageDuration: Number(form.get("imageDuration")), resolution: form.get("resolution"),
        }),
      }, token);
      setJob(data.job);
      await onChanged();
    } catch (error) { onError(error); } finally { setRendering(false); }
  }

  async function download() {
    if (!job) return;
    try {
      const data = await api<{ job: Job }>(`/api/jobs/${job.id}`, {}, token);
      if (data.job.download_url) window.open(data.job.download_url, "_blank", "noopener,noreferrer");
    } catch (error) { onError(error); }
  }

  const canRender = detail.assets.length > 0 && !jobIsActive(job);
  return (
    <div className="editor-grid">
      <div className="editor-main">
        <div className="project-title-block">
          <span className="eyebrow">Project / {detail.project.status}</span>
          <h1>{detail.project.title}</h1>
          <p>{detail.project.topic || "Chưa chọn chủ đề"}</p>
        </div>

        <section className="panel asset-panel">
          <div className="section-title"><div><span className="step-number">01</span><h2>Nguyên liệu</h2></div><span>{detail.assets.length} ảnh</span></div>
          <label className={`drop-zone ${uploading ? "busy" : ""}`}>
            <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void upload(event.target.files)} disabled={uploading} />
            <strong>{uploading ? "Đang tải ảnh..." : "Thả ảnh hoặc bấm để chọn"}</strong>
            <small>JPG, PNG, WEBP · tối đa 25 MB mỗi ảnh</small>
          </label>
          <div className="asset-list">
            {detail.assets.map((asset, index) => <div className="asset-chip" key={asset.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{asset.file_name}</strong><small>{Math.ceil(asset.size_bytes / 1024)} KB</small></div>)}
          </div>
        </section>
      </div>

      <aside className="control-panel">
        <form onSubmit={render}>
          <div className="section-title"><div><span className="step-number">02</span><h2>Đạo diễn</h2></div></div>
          <label>Chủ đề<input name="topic" defaultValue={detail.project.topic || "Storytelling"} /></label>
          <label>Giọng đọc<select name="voice" defaultValue="vi-VN-HoaiMyNeural"><option>vi-VN-HoaiMyNeural</option><option>vi-VN-NamMinhNeural</option><option>en-US-JennyNeural</option></select></label>
          <div className="control-row">
            <label>Giây / ảnh<input name="imageDuration" type="number" min="1" max="10" defaultValue="3" /></label>
            <label>Độ phân giải<select name="resolution" defaultValue="720p"><option>720p</option><option>1080p</option></select></label>
          </div>
          <button className="render-button" disabled={!canRender || rendering}>{rendering ? "Đang gửi..." : "Render video"}<span>→</span></button>
        </form>
        <JobProgress job={job} onDownload={download} />
      </aside>
    </div>
  );
}

function jobIsActive(job?: Job) { return Boolean(job && ["PENDING", "QUEUED", "PROCESSING"].includes(job.status)); }

function JobProgress({ job, onDownload }: { job?: Job; onDownload: () => void }) {
  const statusLabel = useMemo(() => ({
    PENDING: "Đang khởi tạo", QUEUED: "Trong hàng đợi", PROCESSING: "Đang dựng video",
    COMPLETED: "Video hoàn tất", FAILED: "Render thất bại", CANCELED: "Đã hủy",
  }[job?.status ?? "PENDING"]), [job?.status]);
  if (!job) return <div className="job-empty"><span className="step-number">03</span><p>Tiến độ render sẽ xuất hiện tại đây.</p></div>;
  return (
    <div className={`job-card status-${job.status.toLowerCase()}`}>
      <div className="job-status"><span>{statusLabel}</span><strong>{job.progress}%</strong></div>
      <div className="progress-track"><div style={{ width: `${job.progress}%` }} /></div>
      <p>{job.message || job.stage}</p>
      {job.error_code && <code>{job.error_code}</code>}
      {job.status === "COMPLETED" && <button type="button" className="download-button" onClick={onDownload}>Tải video MP4</button>}
    </div>
  );
}

