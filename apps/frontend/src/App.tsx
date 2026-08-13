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
  const [currentTab, setCurrentTab] = useState<"studio" | "library" | "admin">("studio");
  const [shareTarget, setShareTarget] = useState<{ jobId: string; title: string } | null>(null);
  const [showTransactions, setShowTransactions] = useState(false);

  const searchParams = useMemo(() => new URLSearchParams(window.location.search), []);
  const sharedJobId = searchParams.get("v");

  if (sharedJobId) {
    return <PublicVideoViewer jobId={sharedJobId} />;
  }

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
        <div style={{ display: "flex", alignItems: "center", gap: "24px" }}>
          <div className="brand"><span>Frame</span>Foundry</div>
          <nav style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => setCurrentTab("studio")}
              style={{
                background: currentTab === "studio" ? "#ff6b4a" : "transparent",
                color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px",
                fontWeight: 600, cursor: "pointer"
              }}
            >
              🎬 Studio Dự Án
            </button>
            <button
              onClick={() => setCurrentTab("library")}
              style={{
                background: currentTab === "library" ? "#ff6b4a" : "transparent",
                color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px",
                fontWeight: 600, cursor: "pointer"
              }}
            >
              📁 Thư Viện Video AI
            </button>
            {user.role === "ADMIN" && (
              <button
                onClick={() => setCurrentTab("admin")}
                style={{
                  background: currentTab === "admin" ? "#4285f4" : "transparent",
                  color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px",
                  fontWeight: 600, cursor: "pointer"
                }}
              >
                🛡️ Quản Trị (Admin)
              </button>
            )}
          </nav>
        </div>
        <div className="account-strip">
          {user.role === "ADMIN" && <span style={{ backgroundColor: "#4285f4", color: "#fff", padding: "2px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold" }}>ADMIN</span>}
          <span
            className="credit-pill"
            style={{ cursor: "pointer", transition: "transform 0.2s" }}
            title="Bấm để xem lịch sử nạp/dùng credit"
            onClick={() => setShowTransactions(true)}
          >
            💳 {user.credits} credits
          </span>
          <span>{user.display_name}</span>
          <button className="text-button" onClick={logout}>Đăng xuất</button>
        </div>
      </header>

      {currentTab === "library" ? (
        <RenderedLibrary token={token} onShare={(jobId, title) => setShareTarget({ jobId, title })} />
      ) : currentTab === "admin" ? (
        <AdminDashboard token={token} />
      ) : (
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
                onShare={(jobId) => setShareTarget({ jobId, title: detail.project.title })}
              />
            )}
          </section>
        </main>
      )}

      {shareTarget && (
        <ShareModal
          jobId={shareTarget.jobId}
          projectTitle={shareTarget.title}
          onClose={() => setShareTarget(null)}
        />
      )}

      {showTransactions && (
        <TransactionsModal
          token={token}
          onClose={() => setShowTransactions(false)}
        />
      )}
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

function ProjectEditor({ token, detail, onChanged, onError, onShare }: {
  token: string; detail: ProjectDetail; onChanged: () => Promise<void>; onError: (error: unknown) => void; onShare: (jobId: string) => void;
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

  async function deleteAsset(assetId: string) {
    if (!confirm("Xóa ảnh này khỏi dự án?")) return;
    try {
      await api(`/api/projects/${detail.project.id}/assets/${assetId}`, { method: "DELETE" }, token);
      await onChanged();
    } catch (error) { onError(error); }
  }

  async function moveAsset(index: number, direction: number) {
    const newAssets = [...detail.assets];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= newAssets.length) return;
    const [moved] = newAssets.splice(index, 1);
    newAssets.splice(targetIndex, 0, moved);
    const assetIds = newAssets.map((a) => a.id);
    try {
      await api(`/api/projects/${detail.project.id}/assets/reorder`, {
        method: "POST",
        body: JSON.stringify({ assetIds }),
      }, token);
      await onChanged();
    } catch (error) { onError(error); }
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
            {detail.assets.map((asset, index) => (
              <div className="asset-chip" key={asset.id} style={{ display: "grid", gridTemplateColumns: "2rem 1fr auto auto auto", gap: "8px", alignItems: "center" }}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.file_name}</strong>
                <button type="button" onClick={() => moveAsset(index, -1)} disabled={index === 0} style={{ color: "#fff", background: "rgba(255,255,255,0.1)", borderRadius: "4px", padding: "3px 8px", opacity: index === 0 ? 0.3 : 1 }}>⬆</button>
                <button type="button" onClick={() => moveAsset(index, 1)} disabled={index === detail.assets.length - 1} style={{ color: "#fff", background: "rgba(255,255,255,0.1)", borderRadius: "4px", padding: "3px 8px", opacity: index === detail.assets.length - 1 ? 0.3 : 1 }}>⬇</button>
                <button type="button" onClick={() => deleteAsset(asset.id)} style={{ color: "#ef4444", background: "rgba(239,68,68,0.15)", borderRadius: "4px", padding: "3px 8px" }}>🗑️</button>
              </div>
            ))}
          </div>
        </section>
      </div>

      <aside className="control-panel">
        <form onSubmit={render}>
          <div className="section-title"><div><span className="step-number">02</span><h2>Đạo diễn</h2></div></div>
          <label>Chủ đề<input name="topic" defaultValue={detail.project.topic || "Storytelling"} /></label>
          <label>Giọng đọc (Voice AI)
            <select name="voice" defaultValue="vi-VN-HoaiMyNeural">
              <option value="vi-VN-HoaiMyNeural">🇻🇳 vi-VN - Nữ (Hoài Mỹ)</option>
              <option value="vi-VN-NamMinhNeural">🇻🇳 vi-VN - Nam (Nam Minh)</option>
              <option value="en-US-JennyNeural">🇺🇸 en-US - Nữ (Jenny)</option>
              <option value="en-US-GuyNeural">🇺🇸 en-US - Nam (Guy)</option>
              <option value="ja-JP-NanamiNeural">🇯🇵 ja-JP - Nữ (Nanami)</option>
              <option value="ko-KR-SunHiNeural">🇰🇷 ko-KR - Nữ (SunHi)</option>
            </select>
          </label>
          <div className="control-row">
            <label>Giây / ảnh<input name="imageDuration" type="number" min="1" max="10" defaultValue="3" /></label>
            <label>Độ phân giải<select name="resolution" defaultValue="720p"><option>720p</option><option>1080p</option></select></label>
          </div>
          <button className="render-button" disabled={!canRender || rendering}>{rendering ? "Đang gửi..." : "Render video"}<span>→</span></button>
        </form>
        <JobProgress job={job} onDownload={download} onShare={onShare} />
      </aside>
    </div>
  );
}

function jobIsActive(job?: Job) { return Boolean(job && ["PENDING", "QUEUED", "PROCESSING"].includes(job.status)); }

function JobProgress({ job, onDownload, onShare }: { job?: Job; onDownload: () => void; onShare: (jobId: string) => void }) {
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
          <div style={{ display: "flex", gap: "8px" }}>
            <button type="button" className="download-button" style={{ flex: 1 }} onClick={onDownload}>▶ Tải Video MP4</button>
            <button
              type="button"
              style={{
                backgroundColor: "#3b82f6", color: "#fff", border: "none",
                borderRadius: "6px", padding: "10px 14px", fontWeight: "bold", fontSize: "13px", cursor: "pointer"
              }}
              onClick={() => onShare(job.id)}
            >
              🔗 Chia Sẻ
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type RenderedVideo = {
  id: string;
  project_id: string;
  project_title: string;
  project_topic?: string;
  completed_at: string;
  download_url: string;
};

function RenderedLibrary({ token, onShare }: { token: string; onShare: (jobId: string, title: string) => void }) {
  const [videos, setVideos] = useState<RenderedVideo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ videos: RenderedVideo[] }>("/api/rendered-videos", {}, token)
      .then((data) => setVideos(data.videos))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#a0b0a8" }}>Đang tải thư viện video...</div>;
  }

  return (
    <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto" }}>
      <div style={{ marginBottom: "24px" }}>
        <span className="eyebrow">Kho Lưu Trữ</span>
        <h1 style={{ fontSize: "28px", marginTop: "4px" }}>Thư Viện Video AI Đã Render ({videos.length})</h1>
        <p style={{ color: "#a0b0a8" }}>Tất cả video thành phẩm được tạo bởi Magic Hour AI kèm kịch bản, giọng đọc & phụ đề.</p>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state" style={{ margin: "40px 0" }}>
          <span>🎬</span>
          <h2>Chưa có video nào trong kho</h2>
          <p>Hãy sang tab "Studio Dự Án" và bấm Render video đầu tiên của bạn.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "24px" }}>
          {videos.map((video) => (
            <div
              key={video.id}
              style={{
                backgroundColor: "#162822",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: "12px",
                padding: "16px",
                display: "flex",
                flexDirection: "column",
                gap: "12px"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <strong style={{ fontSize: "16px", color: "#fff", display: "block" }}>{video.project_title}</strong>
                  <small style={{ color: "#8aa095" }}>{video.project_topic || "Chưa có chủ đề"}</small>
                </div>
                <span style={{ fontSize: "11px", backgroundColor: "rgba(255,107,74,0.2)", color: "#ff6b4a", padding: "4px 8px", borderRadius: "4px" }}>
                  {new Date(video.completed_at).toLocaleDateString("vi-VN")}
                </span>
              </div>

              {video.download_url && (
                <video
                  src={video.download_url}
                  controls
                  style={{ width: "100%", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "#000" }}
                />
              )}

              <div style={{ display: "flex", gap: "8px", marginTop: "auto" }}>
                {video.download_url && (
                  <a
                    href={video.download_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      flex: 1,
                      textAlign: "center",
                      backgroundColor: "#ff6b4a",
                      color: "#fff",
                      padding: "10px",
                      borderRadius: "6px",
                      textDecoration: "none",
                      fontWeight: 600,
                      fontSize: "14px"
                    }}
                  >
                    ▶ Tải Video
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => onShare(video.id, video.project_title)}
                  style={{
                    backgroundColor: "#3b82f6", color: "#fff", border: "none",
                    borderRadius: "6px", padding: "10px 14px", fontWeight: "bold", fontSize: "13px", cursor: "pointer"
                  }}
                >
                  🔗 Chia Sẻ
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type AdminStats = {
  totalUsers: number;
  totalProjects: number;
  completedVideos: number;
  totalCreditsUsed: number;
};

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
  credits: number;
  created_at: string;
};

type AdminJob = {
  id: string;
  user_email: string;
  user_name: string;
  project_title: string;
  status: string;
  progress: number;
  stage: string;
  created_at: string;
};

function AdminDashboard({ token }: { token: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const loadAdminData = useCallback(async () => {
    try {
      const [sRes, uRes, jRes] = await Promise.all([
        api<{ stats: AdminStats }>("/api/admin/stats", {}, token),
        api<{ users: AdminUser[] }>("/api/admin/users", {}, token),
        api<{ jobs: AdminJob[] }>("/api/admin/jobs", {}, token),
      ]);
      setStats(sRes.stats);
      setUsers(uRes.users);
      setJobs(jRes.jobs);
    } catch (err) {
      console.error(err);
      setNotice("Không thể tải dữ liệu Admin");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  async function adjustCredits(userId: string, currentCredits: number) {
    const input = prompt(`Cấp thêm hoặc trừ Credit cho người dùng (${currentCredits} credits):`, "10");
    if (!input) return;
    const amount = parseInt(input, 10);
    if (isNaN(amount)) return alert("Số lượng credit không hợp lệ");
    try {
      await api(`/api/admin/users/${userId}/credits`, {
        method: "POST",
        body: JSON.stringify({ amount, description: "Admin điều chỉnh credit" }),
      }, token);
      await loadAdminData();
      setNotice("Đã cập nhật Credit thành công!");
    } catch (err) { alert(errorText(err)); }
  }

  async function toggleRole(userId: string, currentRole: string) {
    const newRole = currentRole === "ADMIN" ? "USER" : "ADMIN";
    if (!confirm(`Bạn có chắc muốn đổi vai trò người dùng này sang ${newRole}?`)) return;
    try {
      await api(`/api/admin/users/${userId}/role`, {
        method: "POST",
        body: JSON.stringify({ role: newRole }),
      }, token);
      await loadAdminData();
      setNotice("Đã cập nhật vai trò thành công!");
    } catch (err) { alert(errorText(err)); }
  }

  if (loading) {
    return <div style={{ padding: "40px", textAlign: "center", color: "#a0b0a8" }}>Đang tải bảng quản trị Admin...</div>;
  }

  return (
    <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto" }}>
      {notice && <div className="notice" style={{ marginBottom: "16px" }} onClick={() => setNotice("")}>{notice}</div>}
      
      <div style={{ marginBottom: "28px" }}>
        <span className="eyebrow" style={{ color: "#4285f4" }}>Trang Quản Trị Hệ Thống</span>
        <h1 style={{ fontSize: "28px", marginTop: "4px" }}>Bảng Điều Khiển Admin</h1>
      </div>

      {/* OVERVIEW STATS CARDS */}
      {stats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px", marginBottom: "36px" }}>
          <div style={{ backgroundColor: "#162822", border: "1px solid rgba(66,133,244,0.3)", borderRadius: "10px", padding: "20px" }}>
            <span style={{ fontSize: "12px", color: "#a0b0a8" }}>Tổng Số Người Dùng</span>
            <h2 style={{ fontSize: "32px", color: "#4285f4", margin: "8px 0 0 0" }}>{stats.totalUsers}</h2>
          </div>
          <div style={{ backgroundColor: "#162822", border: "1px solid rgba(255,107,74,0.3)", borderRadius: "10px", padding: "20px" }}>
            <span style={{ fontSize: "12px", color: "#a0b0a8" }}>Tổng Số Dự Án Video</span>
            <h2 style={{ fontSize: "32px", color: "#ff6b4a", margin: "8px 0 0 0" }}>{stats.totalProjects}</h2>
          </div>
          <div style={{ backgroundColor: "#162822", border: "1px solid rgba(52,168,83,0.3)", borderRadius: "10px", padding: "20px" }}>
            <span style={{ fontSize: "12px", color: "#a0b0a8" }}>Video Đã Render Xong</span>
            <h2 style={{ fontSize: "32px", color: "#34a853", margin: "8px 0 0 0" }}>{stats.completedVideos}</h2>
          </div>
          <div style={{ backgroundColor: "#162822", border: "1px solid rgba(251,188,5,0.3)", borderRadius: "10px", padding: "20px" }}>
            <span style={{ fontSize: "12px", color: "#a0b0a8" }}>Credits Đã Đào Tiêu Phí</span>
            <h2 style={{ fontSize: "32px", color: "#fbbc05", margin: "8px 0 0 0" }}>{stats.totalCreditsUsed}</h2>
          </div>
        </div>
      )}

      {/* USER MANAGEMENT SECTION */}
      <section style={{ marginBottom: "40px" }}>
        <h2 style={{ fontSize: "20px", marginBottom: "16px", color: "#fff" }}>Danh Sách Người Dùng ({users.length})</h2>
        <div style={{ overflowX: "auto", backgroundColor: "#162822", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#a0b0a8" }}>
                <th style={{ padding: "12px 16px" }}>Tên / Email</th>
                <th style={{ padding: "12px 16px" }}>Vai trò</th>
                <th style={{ padding: "12px 16px" }}>Credits</th>
                <th style={{ padding: "12px 16px" }}>Ngày tạo</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Hành động</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "12px 16px" }}>
                    <strong style={{ color: "#fff", display: "block" }}>{u.display_name}</strong>
                    <small style={{ color: "#8aa095" }}>{u.email}</small>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{
                      backgroundColor: u.role === "ADMIN" ? "rgba(66,133,244,0.2)" : "rgba(255,255,255,0.08)",
                      color: u.role === "ADMIN" ? "#4285f4" : "#a0b0a8",
                      padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold"
                    }}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <strong style={{ color: "#ff6b4a" }}>{u.credits}</strong> credits
                  </td>
                  <td style={{ padding: "12px 16px", color: "#8aa095", fontSize: "12px" }}>
                    {new Date(u.created_at).toLocaleString("vi-VN")}
                  </td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    <button
                      onClick={() => adjustCredits(u.id, u.credits)}
                      style={{ backgroundColor: "#2b4c3f", color: "#fff", border: "none", padding: "6px 12px", borderRadius: "4px", cursor: "pointer", marginRight: "8px", fontSize: "12px" }}
                    >
                      ＋/－ Credits
                    </button>
                    <button
                      onClick={() => toggleRole(u.id, u.role)}
                      style={{ backgroundColor: "transparent", color: "#4285f4", border: "1px solid #4285f4", padding: "5px 10px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
                    >
                      Đổi Vai Trò
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* RENDER JOBS MONITOR */}
      <section>
        <h2 style={{ fontSize: "20px", marginBottom: "16px", color: "#fff" }}>Tiến Trình Render Gần Đây ({jobs.length})</h2>
        <div style={{ overflowX: "auto", backgroundColor: "#162822", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#a0b0a8" }}>
                <th style={{ padding: "12px 16px" }}>Tên Dự Án</th>
                <th style={{ padding: "12px 16px" }}>Người Yêu Cầu</th>
                <th style={{ padding: "12px 16px" }}>Trạng Thái</th>
                <th style={{ padding: "12px 16px" }}>Tiến Độ</th>
                <th style={{ padding: "12px 16px" }}>Thời Gian</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                  <td style={{ padding: "12px 16px", color: "#fff", fontWeight: 600 }}>{j.project_title}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ color: "#fff" }}>{j.user_name}</span><br />
                    <small style={{ color: "#8aa095" }}>{j.user_email}</small>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{
                      backgroundColor: j.status === "COMPLETED" ? "rgba(52,168,83,0.2)" : j.status === "FAILED" ? "rgba(234,67,53,0.2)" : "rgba(251,188,5,0.2)",
                      color: j.status === "COMPLETED" ? "#34a853" : j.status === "FAILED" ? "#ea4335" : "#fbbc05",
                      padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold"
                    }}>
                      {j.status}
                    </span>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#fff" }}>{j.progress}%</td>
                  <td style={{ padding: "12px 16px", color: "#8aa095", fontSize: "12px" }}>
                    {new Date(j.created_at).toLocaleString("vi-VN")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function ShareModal({ jobId, projectTitle, onClose }: { jobId: string; projectTitle: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const shareUrl = `${window.location.origin}/?v=${jobId}`;

  function copyLink() {
    navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const encodedUrl = encodeURIComponent(shareUrl);
  const encodedTitle = encodeURIComponent(`Xem video AI "${projectTitle}" được render bằng FrameFoundry!`);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: "20px"
    }}>
      <div style={{
        backgroundColor: "#132238", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "16px", padding: "28px", maxWidth: "480px", width: "100%",
        boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "20px", color: "#fff", margin: 0 }}>🔗 Chia Sẻ Video AI</h2>
          <button onClick={onClose} style={{ color: "#a0b0a8", fontSize: "20px", cursor: "pointer" }}>✕</button>
        </div>

        <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "16px" }}>
          Chia sẻ liên kết này với bất kỳ ai để họ có thể xem trực tuyến và tải video <strong>"{projectTitle}"</strong> mà không cần đăng nhập.
        </p>

        <div style={{ display: "flex", gap: "8px", marginBottom: "20px" }}>
          <input
            type="text"
            readOnly
            value={shareUrl}
            style={{ flex: 1, backgroundColor: "#1b2e4b", color: "#fff", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px", padding: "10px 12px", fontSize: "13px" }}
          />
          <button
            onClick={copyLink}
            style={{
              backgroundColor: copied ? "#10b981" : "#3b82f6", color: "#fff", border: "none",
              borderRadius: "8px", padding: "10px 16px", fontWeight: "bold", fontSize: "13px", cursor: "pointer", transition: "all 0.2s"
            }}
          >
            {copied ? "✓ Đã Chép" : "📋 Sao Chép"}
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
          <a
            href={`mailto:?subject=${encodedTitle}&body=Hãy xem video AI tôi vừa tạo: ${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textAlign: "center", backgroundColor: "#1b2e4b", color: "#fff", padding: "10px", borderRadius: "8px", textDecoration: "none", fontSize: "13px", fontWeight: 600 }}
          >
            ✉️ Email
          </a>
          <a
            href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textAlign: "center", backgroundColor: "#1877f2", color: "#fff", padding: "10px", borderRadius: "8px", textDecoration: "none", fontSize: "13px", fontWeight: 600 }}
          >
            📱 Facebook
          </a>
          <a
            href={`https://zalo.me/share?url=${encodedUrl}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ textAlign: "center", backgroundColor: "#0068ff", color: "#fff", padding: "10px", borderRadius: "8px", textDecoration: "none", fontSize: "13px", fontWeight: 600 }}
          >
            💬 Zalo
          </a>
        </div>
      </div>
    </div>
  );
}

type PublicVideo = {
  id: string;
  project_title: string;
  project_topic?: string;
  creator_name: string;
  download_url: string;
  completed_at: string;
};

function PublicVideoViewer({ jobId }: { jobId: string }) {
  const [video, setVideo] = useState<PublicVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/public/videos/${jobId}`)
      .then((res) => {
        if (!res.ok) throw new Error("VIDEO_NOT_FOUND");
        return res.json();
      })
      .then((data) => setVideo(data.video))
      .catch(() => setError("Video không tồn tại hoặc đã bị gỡ."))
      .finally(() => setLoading(false));
  }, [jobId]);

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0b1320", color: "#fff", display: "flex", flexDirection: "column" }}>
      <header className="topbar">
        <div className="brand"><span>Frame</span>Foundry AI</div>
        <a href="/" style={{ color: "#3b82f6", textDecoration: "none", fontWeight: 600, fontSize: "14px" }}>
          🎬 Mở Studio Tạo Video AI ➔
        </a>
      </header>

      <main style={{ flex: 1, display: "grid", placeItems: "center", padding: "32px 20px" }}>
        {loading ? (
          <div style={{ color: "#94a3b8" }}>Đang tải video...</div>
        ) : error ? (
          <div style={{ textAlign: "center" }}>
            <span style={{ fontSize: "48px" }}>🎬</span>
            <h2 style={{ margin: "16px 0 8px" }}>{error}</h2>
            <a href="/" style={{ color: "#ff6b4a" }}>Quay về trang chủ</a>
          </div>
        ) : video && (
          <div style={{ maxWidth: "720px", width: "100%", backgroundColor: "#132238", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "16px", padding: "24px", boxShadow: "0 20px 40px rgba(0,0,0,0.4)" }}>
            <div style={{ marginBottom: "16px" }}>
              <span className="eyebrow" style={{ color: "#3b82f6" }}>Video AI Được Chia Sẻ</span>
              <h1 style={{ fontSize: "24px", margin: "4px 0 6px" }}>{video.project_title}</h1>
              <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
                Tạo bởi <strong>{video.creator_name}</strong> · {video.project_topic || "Magic Hour AI Studio"}
              </p>
            </div>

            {video.download_url && (
              <video
                src={video.download_url}
                controls
                autoPlay
                style={{ width: "100%", borderRadius: "12px", border: "1px solid rgba(255,255,255,0.1)", backgroundColor: "#000", marginBottom: "20px" }}
              />
            )}

            <div style={{ display: "flex", gap: "12px" }}>
              {video.download_url && (
                <a
                  href={video.download_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ flex: 1, textAlign: "center", backgroundColor: "#ff6b4a", color: "#fff", padding: "12px", borderRadius: "8px", textDecoration: "none", fontWeight: 700, fontSize: "15px" }}
                >
                  ▶ Tải Video MP4 Về Máy
                </a>
              )}
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href);
                  alert("Đã sao chép liên kết chia sẻ video!");
                }}
                style={{ backgroundColor: "#1b2e4b", color: "#fff", border: "1px solid rgba(255,255,255,0.15)", borderRadius: "8px", padding: "12px 20px", fontWeight: 600, fontSize: "14px", cursor: "pointer" }}
              >
                📋 Sao Chép Link
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

type TransactionRecord = {
  id: string;
  kind: string;
  credits: number;
  description: string;
  created_at: string;
};

function TransactionsModal({ token, onClose }: { token: string; onClose: () => void }) {
  const [items, setItems] = useState<TransactionRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ transactions: TransactionRecord[] }>("/api/auth/transactions", {}, token)
      .then((data) => setItems(data.transactions))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: "20px"
    }}>
      <div style={{
        backgroundColor: "#132238", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "16px", padding: "28px", maxWidth: "560px", width: "100%",
        maxHeight: "80vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 50px rgba(0,0,0,0.5)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "20px", color: "#fff", margin: 0 }}>💳 Lịch Sử Giao Dịch Credit</h2>
          <button onClick={onClose} style={{ color: "#a0b0a8", fontSize: "20px", cursor: "pointer" }}>✕</button>
        </div>

        {loading ? (
          <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Đang tải lịch sử giao dịch...</div>
        ) : (
          <div style={{ overflowY: "auto", flex: 1 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#94a3b8" }}>
                  <th style={{ padding: "10px" }}>Nội dung</th>
                  <th style={{ padding: "10px" }}>Credits</th>
                  <th style={{ padding: "10px", textAlign: "right" }}>Thời gian</th>
                </tr>
              </thead>
              <tbody>
                {items.map((t) => (
                  <tr key={t.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "10px", color: "#fff" }}>{t.description || t.kind}</td>
                    <td style={{ padding: "10px", fontWeight: "bold", color: t.credits > 0 ? "#10b981" : "#ff6b4a" }}>
                      {t.credits > 0 ? `+${t.credits}` : t.credits}
                    </td>
                    <td style={{ padding: "10px", textAlign: "right", color: "#94a3b8", fontSize: "11px" }}>
                      {new Date(t.created_at).toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

