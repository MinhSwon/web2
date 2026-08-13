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

  useEffect(() => {
    const g = (window as any).google;
    if (g?.accounts?.id) {
      try {
        g.accounts.id.initialize({
          client_id: "1045439359942-cbacnii8usnh58vjdkpnoat38gpta2hn.apps.googleusercontent.com",
          callback: async (response: any) => {
            if (!response.credential) return;
            setBusy(true); setError("");
            try {
              const data = await api<{ token: string; user: User }>("/api/auth/google", {
                method: "POST",
                body: JSON.stringify({ credential: response.credential }),
              });
              onAuthenticated(data.token, data.user);
            } catch (caught) { setError(errorText(caught)); } finally { setBusy(false); }
          },
        });
        const container = document.getElementById("google-gsi-btn");
        if (container) {
          container.innerHTML = "";
          g.accounts.id.renderButton(container, { theme: "filled_blue", size: "large", width: 320, text: "continue_with" });
        }
      } catch (e) {
        console.log("Google GSI init notice:", e);
      }
    }
  }, [onAuthenticated]);

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

  async function googleLogin() {
    const g = (window as any).google;
    const clientId = "1045439359942-cbacnii8usnh58vjdkpnoat38gpta2hn.apps.googleusercontent.com";

    if (g?.accounts?.oauth2) {
      const client = g.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        callback: async (tokenResponse: any) => {
          if (tokenResponse.access_token) {
            setBusy(true); setError("");
            try {
              const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
                headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
              });
              const profile = await res.json();
              if (profile.email) {
                const data = await api<{ token: string; user: User }>("/api/auth/google", {
                  method: "POST",
                  body: JSON.stringify({ email: profile.email, displayName: profile.name || profile.given_name }),
                });
                onAuthenticated(data.token, data.user);
              }
            } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
          }
        },
      });
      client.requestAccessToken();
      return;
    }

    // Direct OAuth 2.0 popup window fallback
    const scope = encodeURIComponent("https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile");
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=${encodeURIComponent(window.location.origin)}&response_type=token&scope=${scope}`;
    window.location.href = authUrl;
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
          
          <button
            type="button"
            className="secondary-button google-auth-btn"
            onClick={googleLogin}
            disabled={busy}
            style={{
              width: "100%",
              padding: "14px",
              marginBottom: "16px",
              backgroundColor: "#4285F4",
              color: "#ffffff",
              border: "none",
              borderRadius: "8px",
              fontWeight: 600,
              fontSize: "15px",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "12px",
              boxShadow: "0 2px 4px rgba(0,0,0,0.2)"
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" style={{ backgroundColor: "#fff", borderRadius: "4px", padding: "2px" }}>
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
            </svg>
            Đăng nhập bằng Gmail (Google Sign-In)
          </button>
          
          <div style={{ textAlign: "center", margin: "10px 0", color: "#888", fontSize: "12px" }}>— HOẶC BẰNG EMAIL —</div>

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
    PENDING: "Đang khởi tạo", QUEUED: "Trong hàng đợi", PROCESSING: "Đang dựng video (Kịch bản, Giọng đọc, Phụ đề, Motion)",
    COMPLETED: "Video hoàn tất", FAILED: "Render thất bại", CANCELED: "Đã hủy",
  }[job?.status ?? "PENDING"]), [job?.status]);
  if (!job) return <div className="job-empty"><span className="step-number">03</span><p>Tiến độ render sẽ xuất hiện tại đây.</p></div>;
  return (
    <div className={`job-card status-${job.status.toLowerCase()}`}>
      <div className="job-status"><span>{statusLabel}</span><strong>{job.progress}%</strong></div>
      <div className="progress-track"><div style={{ width: `${job.progress}%` }} /></div>
      <p>{job.message || job.stage}</p>
      {job.error_code && <code>{job.error_code}</code>}
      {job.status === "COMPLETED" && (
        <div className="completed-preview-block" style={{ marginTop: "1rem" }}>
          {job.download_url && (
            <video
              src={job.download_url}
              controls
              autoPlay
              style={{ width: "100%", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.15)", marginBottom: "0.8rem", backgroundColor: "#000" }}
            />
          )}
          <button type="button" className="download-button" onClick={onDownload}>Tải video MP4</button>
        </div>
      )}
    </div>
  );
}

