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
  const [showTokenShop, setShowTokenShop] = useState(false);

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

  // Handle VNPay / Gateway redirect returns (e.g. ?payment=success&orderCode=FFXXXXXX)
  useEffect(() => {
    const paymentStatus = searchParams.get("payment");
    const orderCode = searchParams.get("orderCode");
    if (paymentStatus === "success") {
      setNotice(`🎉 Thanh toán thành công cho đơn hàng ${orderCode || ""}! Số dư Credit của bạn đã được cập nhật.`);
      if (token) {
        api<{ user: User }>("/api/auth/me", {}, token)
          .then((me) => setUser(me.user))
          .catch(console.error);
      }
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === "failed") {
      setNotice(`⚠️ Giao dịch thanh toán chưa hoàn tất hoặc bị hủy.`);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [searchParams, token]);

  // Background real-time Credit synchronizer & notification
  useEffect(() => {
    if (!token || !user) return;
    const interval = setInterval(async () => {
      try {
        const me = await api<{ user: User }>("/api/auth/me", {}, token);
        if (me.user.credits > user.credits) {
          const diff = me.user.credits - user.credits;
          setUser(me.user);
          setNotice(`🎉 Nạp tiền thành công! Bạn vừa nhận được +${diff} Credits (Số dư hiện tại: ${me.user.credits} Credits).`);
        }
      } catch (err) {
        // silent
      }
    }, 8000);

    return () => clearInterval(interval);
  }, [token, user]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId).catch((error) => setNotice(errorText(error)));
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

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
            <button
              onClick={() => setShowTokenShop(true)}
              style={{
                background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                color: "#fff", border: "none", padding: "8px 16px", borderRadius: "6px",
                fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: "6px",
                boxShadow: "0 2px 10px rgba(245,158,11,0.35)"
              }}
            >
              💎 Mua Token
            </button>
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
          <button
            onClick={() => setShowTokenShop(true)}
            style={{
              backgroundColor: "rgba(245,158,11,0.15)", color: "#f59e0b",
              border: "1px solid rgba(245,158,11,0.3)", padding: "3px 8px", borderRadius: "4px",
              fontSize: "12px", fontWeight: "bold", cursor: "pointer"
            }}
          >
            ＋ Nạp
          </button>
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
                onOpenShop={() => setShowTokenShop(true)}
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

      {showTokenShop && user && (
        <TokenShopModal
          token={token}
          user={user}
          onPurchased={(u) => setUser(u)}
          onClose={() => setShowTokenShop(false)}
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
    function initGoogle() {
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
            g.accounts.id.renderButton(container, {
              type: "standard",
              theme: "filled_blue",
              size: "large",
              text: "continue_with",
              shape: "rectangular",
              width: 320,
            });
          }
        } catch (e) {
          console.log("Google GSI init notice:", e);
        }
      }
    }

    initGoogle();
    const timer = setTimeout(initGoogle, 800);
    return () => clearTimeout(timer);
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

    // 1. Try Google Identity Services One-Tap / Prompt
    if (g?.accounts?.id) {
      g.accounts.id.prompt((notification: any) => {
        if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
          // Fallback to OAuth2 Token Client Popup
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
            client.requestAccessToken({ prompt: "consent" });
          }
        }
      });
      return;
    }

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
      client.requestAccessToken({ prompt: "consent" });
      return;
    }

    setError("Đang tải thư viện Google Sign-In, vui lòng thử lại sau vài giây...");
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
          
          {/* Google Official GSI Button (100% compliant with Google OAuth Policies) */}
          <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px", minHeight: "44px", width: "100%" }}>
            <div id="google-gsi-btn"></div>
          </div>

          <div style={{ textAlign: "center", margin: "8px 0", color: "#888", fontSize: "12px" }}>— HOẶC BẰNG EMAIL —</div>

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

function ProjectEditor({ token, detail, onChanged, onError, onShare, onOpenShop }: {
  token: string; detail: ProjectDetail; onChanged: () => Promise<void>; onError: (error: unknown) => void; onShare: (jobId: string) => void; onOpenShop?: () => void;
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
        const uploadUrl = `/api/projects/${detail.project.id}/upload-direct?fileName=${encodeURIComponent(file.name)}`;
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": file.type || "image/png",
          },
          body: file,
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || `Upload thất bại: ${file.name}`);
        }
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
      const res = await fetch(`/api/jobs/${job.id}/download`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) throw new Error("Không thể tải video");
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${detail.project.title || "video"}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
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
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        const res = await fetch(`/api/jobs/${video.id}/download`, {
                          headers: { Authorization: `Bearer ${token}` }
                        });
                        if (!res.ok) throw new Error("Không thể tải video");
                        const blob = await res.blob();
                        const url = window.URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${video.project_title || "video"}.mp4`;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        window.URL.revokeObjectURL(url);
                      } catch (err) { alert(errorText(err)); }
                    }}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      backgroundColor: "#ff6b4a",
                      color: "#fff",
                      padding: "10px",
                      borderRadius: "6px",
                      border: "none",
                      fontWeight: 600,
                      fontSize: "14px",
                      cursor: "pointer"
                    }}
                  >
                    ⬇ Tải Video MP4
                  </button>
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

type AdminPromoCode = {
  id: string;
  code: string;
  credits_reward: number;
  max_uses: number;
  used_count: number;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
};

type AdminPaymentOrder = {
  id: string;
  user_email: string;
  user_name: string;
  order_code: string;
  package_name: string;
  credits: number;
  amount_vnd: number;
  gateway: string;
  status: string;
  transaction_ref: string | null;
  paid_at: string | null;
  created_at: string;
};

type AdminOrderStats = {
  total_orders: number;
  successful_orders: number;
  total_revenue_vnd: number;
};

const VIETNAM_BANKS = [
  { id: "MB", name: "MB Bank (Ngân Hàng Quân Đội)" },
  { id: "VCB", name: "Vietcombank (Ngoại Thương Việt Nam)" },
  { id: "TCB", name: "Techcombank (Kỹ Thương Việt Nam)" },
  { id: "VPB", name: "VPBank (Việt Nam Thịnh Vượng)" },
  { id: "ACB", name: "ACB (Á Châu)" },
  { id: "BIDV", name: "BIDV (Đầu Tư & Phát Triển)" },
  { id: "ICB", name: "VietinBank (Công Thương Việt Nam)" },
  { id: "TPB", name: "TPBank (Tiên Phong)" },
  { id: "STB", name: "Sacombank (Sài Gòn Thương Tín)" },
  { id: "HDB", name: "HDBank (Phát Triển TP.HCM)" },
  { id: "VIB", name: "VIB (Quốc Tế Việt Nam)" },
  { id: "MSB", name: "MSB (Hàng Hải)" },
  { id: "SHB", name: "SHB (Sài Gòn - Hà Nội)" },
  { id: "OCB", name: "OCB (Phương Đông)" },
];

type BankConfig = {
  bank_id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
};

function AdminDashboard({ token }: { token: string }) {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [promoCodes, setPromoCodes] = useState<AdminPromoCode[]>([]);
  const [orders, setOrders] = useState<AdminPaymentOrder[]>([]);
  const [orderStats, setOrderStats] = useState<AdminOrderStats | null>(null);
  const [bankConfig, setBankConfig] = useState<BankConfig>({
    bank_id: "MB",
    bank_name: "MB Bank (Ngân Hàng Quân Đội)",
    account_no: "999988886666",
    account_name: "FRAME FOUNDRY AI",
  });
  const [savingBank, setSavingBank] = useState(false);
  const [newPromoCode, setNewPromoCode] = useState("");
  const [newPromoCredits, setNewPromoCredits] = useState(20);
  const [newPromoMaxUses, setNewPromoMaxUses] = useState(100);
  const [newPromoDays, setNewPromoDays] = useState(30);
  const [creatingPromo, setCreatingPromo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const loadAdminData = useCallback(async () => {
    try {
      const [sRes, uRes, jRes, pRes, oRes, bRes] = await Promise.all([
        api<{ stats: AdminStats }>("/api/admin/stats", {}, token),
        api<{ users: AdminUser[] }>("/api/admin/users", {}, token),
        api<{ jobs: AdminJob[] }>("/api/admin/jobs", {}, token),
        api<{ promoCodes: AdminPromoCode[] }>("/api/admin/promo-codes", {}, token),
        api<{ orders: AdminPaymentOrder[]; stats: AdminOrderStats }>("/api/admin/orders", {}, token),
        api<{ bank: BankConfig }>("/api/admin/settings/bank", {}, token),
      ]);
      setStats(sRes.stats);
      setUsers(uRes.users);
      setJobs(jRes.jobs);
      setPromoCodes(pRes.promoCodes || []);
      setOrders(oRes.orders || []);
      setOrderStats(oRes.stats);
      if (bRes.bank) setBankConfig(bRes.bank);
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

  async function handleCreatePromoCode(e: React.FormEvent) {
    e.preventDefault();
    if (!newPromoCode.trim()) return;
    setCreatingPromo(true);
    try {
      await api("/api/admin/promo-codes", {
        method: "POST",
        body: JSON.stringify({
          code: newPromoCode,
          creditsReward: newPromoCredits,
          maxUses: newPromoMaxUses,
          expiresInDays: newPromoDays,
        }),
      }, token);
      setNewPromoCode("");
      await loadAdminData();
      setNotice("Tạo mã khuyến mãi mới thành công!");
    } catch (err) {
      alert(errorText(err));
    } finally {
      setCreatingPromo(false);
    }
  }

  async function togglePromoCode(id: string) {
    try {
      await api(`/api/admin/promo-codes/${id}/toggle`, { method: "PATCH" }, token);
      await loadAdminData();
      setNotice("Đã cập nhật trạng thái mã khuyến mãi!");
    } catch (err) { alert(errorText(err)); }
  }

  async function deletePromoCode(id: string, code: string) {
    if (!confirm(`Bạn có chắc muốn xóa mã khuyến mãi ${code}?`)) return;
    try {
      await api(`/api/admin/promo-codes/${id}`, { method: "DELETE" }, token);
      await loadAdminData();
      setNotice("Đã xóa mã khuyến mãi!");
    } catch (err) { alert(errorText(err)); }
  }

  async function handleSaveBankConfig(e: React.FormEvent) {
    e.preventDefault();
    if (!bankConfig.account_no.trim() || !bankConfig.account_name.trim()) return;
    setSavingBank(true);
    try {
      const selectedBank = VIETNAM_BANKS.find((b) => b.id === bankConfig.bank_id);
      const res = await api<{ success: boolean; bank: BankConfig; message: string }>("/api/admin/settings/bank", {
        method: "POST",
        body: JSON.stringify({
          bank_id: bankConfig.bank_id,
          bank_name: selectedBank?.name || bankConfig.bank_name,
          account_no: bankConfig.account_no.trim(),
          account_name: bankConfig.account_name.trim().toUpperCase(),
        }),
      }, token);
      setBankConfig(res.bank);
      setNotice("✅ " + res.message);
    } catch (err) {
      alert(errorText(err));
    } finally {
      setSavingBank(false);
    }
  }

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

      {/* PROMO CODES MANAGER */}
      <section style={{ marginBottom: "36px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "20px", color: "#fff", margin: 0 }}>🏷️ Quản Lý Mã Khuyến Mãi (Promo Codes) ({promoCodes.length})</h2>
        </div>

        {/* CREATE PROMO CODE FORM */}
        <form onSubmit={handleCreatePromoCode} style={{
          backgroundColor: "#162822",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "10px",
          padding: "20px",
          marginBottom: "20px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr)) auto",
          gap: "12px",
          alignItems: "end"
        }}>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#a0b0a8", marginBottom: "6px" }}>Mã Khuyến Mãi (Code):</label>
            <input
              type="text"
              required
              placeholder="VD: WELCOME2026"
              value={newPromoCode}
              onChange={(e) => setNewPromoCode(e.target.value.toUpperCase())}
              style={{
                width: "100%", backgroundColor: "#0f1d18", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px", padding: "8px 12px", color: "#fff", fontWeight: "bold", textTransform: "uppercase"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#a0b0a8", marginBottom: "6px" }}>Số Credits Thưởng:</label>
            <input
              type="number"
              min="1"
              required
              value={newPromoCredits}
              onChange={(e) => setNewPromoCredits(parseInt(e.target.value, 10) || 1)}
              style={{
                width: "100%", backgroundColor: "#0f1d18", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px", padding: "8px 12px", color: "#fff"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#a0b0a8", marginBottom: "6px" }}>Số Lượt Dùng Tối Đa:</label>
            <input
              type="number"
              min="1"
              required
              value={newPromoMaxUses}
              onChange={(e) => setNewPromoMaxUses(parseInt(e.target.value, 10) || 1)}
              style={{
                width: "100%", backgroundColor: "#0f1d18", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px", padding: "8px 12px", color: "#fff"
              }}
            />
          </div>
          <div>
            <label style={{ display: "block", fontSize: "12px", color: "#a0b0a8", marginBottom: "6px" }}>Hạn Dùng (Số Ngày):</label>
            <input
              type="number"
              min="1"
              value={newPromoDays}
              onChange={(e) => setNewPromoDays(parseInt(e.target.value, 10) || 30)}
              style={{
                width: "100%", backgroundColor: "#0f1d18", border: "1px solid rgba(255,255,255,0.2)",
                borderRadius: "6px", padding: "8px 12px", color: "#fff"
              }}
            />
          </div>
          <button
            type="submit"
            disabled={creatingPromo}
            style={{
              backgroundColor: "#10b981", color: "#fff", border: "none",
              borderRadius: "6px", padding: "10px 18px", fontWeight: "bold",
              cursor: creatingPromo ? "not-allowed" : "pointer", height: "40px"
            }}
          >
            {creatingPromo ? "Đang tạo..." : "＋ Tạo Mã Mới"}
          </button>
        </form>

        {/* PROMO CODES TABLE */}
        <div style={{ overflowX: "auto", backgroundColor: "#162822", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#a0b0a8" }}>
                <th style={{ padding: "12px 16px" }}>Mã Code</th>
                <th style={{ padding: "12px 16px" }}>Thưởng Credits</th>
                <th style={{ padding: "12px 16px" }}>Đã Dùng / Tối Đa</th>
                <th style={{ padding: "12px 16px" }}>Hạn Sử Dụng</th>
                <th style={{ padding: "12px 16px" }}>Trạng Thái</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Thao Tác</th>
              </tr>
            </thead>
            <tbody>
              {promoCodes.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: "20px", textAlign: "center", color: "#8aa095" }}>
                    Chưa có mã khuyến mãi nào. Hãy tạo mã đầu tiên ở trên!
                  </td>
                </tr>
              ) : (
                promoCodes.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "12px 16px" }}>
                      <strong style={{ color: "#f59e0b", letterSpacing: "1px" }}>{p.code}</strong>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <strong style={{ color: "#10b981" }}>+{p.credits_reward}</strong> credits
                    </td>
                    <td style={{ padding: "12px 16px", color: "#fff" }}>
                      {p.used_count} / {p.max_uses}
                    </td>
                    <td style={{ padding: "12px 16px", color: "#8aa095", fontSize: "12px" }}>
                      {p.expires_at ? new Date(p.expires_at).toLocaleDateString("vi-VN") : "Vĩnh viễn"}
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        backgroundColor: p.is_active ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)",
                        color: p.is_active ? "#10b981" : "#ef4444",
                        padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold"
                      }}>
                        {p.is_active ? "Hoạt Động" : "Đã Tắt"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right" }}>
                      <button
                        onClick={() => togglePromoCode(p.id)}
                        style={{
                          backgroundColor: "transparent", color: p.is_active ? "#f59e0b" : "#10b981",
                          border: `1px solid ${p.is_active ? "#f59e0b" : "#10b981"}`,
                          padding: "4px 8px", borderRadius: "4px", cursor: "pointer", marginRight: "6px", fontSize: "12px"
                        }}
                      >
                        {p.is_active ? "Tắt" : "Bật"}
                      </button>
                      <button
                        onClick={() => deletePromoCode(p.id, p.code)}
                        style={{ backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer", fontSize: "12px" }}
                      >
                        Xóa
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* BANK & VIETQR SETTINGS SECTION */}
      <section style={{ marginBottom: "40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "20px", color: "#fff", margin: 0 }}>🏦 Cấu Hình Tài Khoản Ngân Hàng & VietQR</h2>
          <span style={{ fontSize: "12px", color: "#10b981", backgroundColor: "rgba(16,185,129,0.1)", padding: "4px 10px", borderRadius: "6px", border: "1px solid rgba(16,185,129,0.2)" }}>
            ⚡ Tự động đổi mã QR toàn hệ thống ngay khi lưu
          </span>
        </div>

        <div style={{
          backgroundColor: "#162822",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "14px",
          padding: "24px",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "24px",
          alignItems: "center"
        }}>
          <form onSubmit={handleSaveBankConfig} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#a0b0a8", marginBottom: "6px" }}>
                Ngân Hàng Thụ Hưởng:
              </label>
              <select
                value={bankConfig.bank_id}
                onChange={(e) => {
                  const b = VIETNAM_BANKS.find((item) => item.id === e.target.value);
                  setBankConfig({
                    ...bankConfig,
                    bank_id: e.target.value,
                    bank_name: b?.name || bankConfig.bank_name,
                  });
                }}
                style={{
                  width: "100%",
                  backgroundColor: "#0f1d18",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  color: "#fff",
                  fontSize: "14px"
                }}
              >
                {VIETNAM_BANKS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.id})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#a0b0a8", marginBottom: "6px" }}>
                Số Tài Khoản Ngân Hàng:
              </label>
              <input
                type="text"
                required
                placeholder="VD: 0987654321 hoặc 99998888..."
                value={bankConfig.account_no}
                onChange={(e) => setBankConfig({ ...bankConfig, account_no: e.target.value.trim() })}
                style={{
                  width: "100%",
                  backgroundColor: "#0f1d18",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  color: "#60a5fa",
                  fontWeight: 700,
                  fontSize: "15px"
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", color: "#a0b0a8", marginBottom: "6px" }}>
                Tên Chủ Tài Khoản (Viết Hoa Không Dấu):
              </label>
              <input
                type="text"
                required
                placeholder="VD: NGUYEN VAN A hoặc CONG TY TNHH..."
                value={bankConfig.account_name}
                onChange={(e) => setBankConfig({ ...bankConfig, account_name: e.target.value.toUpperCase() })}
                style={{
                  width: "100%",
                  backgroundColor: "#0f1d18",
                  border: "1px solid rgba(255,255,255,0.2)",
                  borderRadius: "8px",
                  padding: "10px 14px",
                  color: "#fff",
                  fontWeight: 700,
                  fontSize: "14px",
                  textTransform: "uppercase"
                }}
              />
            </div>

            <button
              type="submit"
              disabled={savingBank}
              style={{
                backgroundColor: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: "8px",
                padding: "12px 20px",
                fontWeight: 700,
                fontSize: "14px",
                cursor: savingBank ? "not-allowed" : "pointer",
                boxShadow: "0 4px 15px rgba(16,185,129,0.3)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px"
              }}
            >
              {savingBank ? "Đang lưu cấu hình..." : "💾 Lưu Cấu Hình Ngân Hàng Mới"}
            </button>
          </form>

          {/* LIVE PREVIEW VIETQR CARD */}
          <div style={{
            backgroundColor: "#0f1d18",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "12px",
            padding: "20px",
            textAlign: "center"
          }}>
            <span style={{ fontSize: "12px", color: "#f59e0b", fontWeight: 700, display: "block", marginBottom: "10px" }}>
              🔍 Xem Trước Mã QR Tạo Ra (Live Preview)
            </span>
            <div style={{ backgroundColor: "#fff", padding: "12px", borderRadius: "10px", display: "inline-block", maxWidth: "210px" }}>
              <img
                src={`https://img.vietqr.io/image/${bankConfig.bank_id}-${bankConfig.account_no}-compact2.png?amount=50000&addInfo=DEMO&accountName=${encodeURIComponent(bankConfig.account_name)}`}
                alt="VietQR Xem Trước"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <div style={{ marginTop: "12px", fontSize: "13px", color: "#cbd5e1" }}>
              <p style={{ margin: "0 0 2px" }}><strong>{bankConfig.bank_name}</strong></p>
              <p style={{ margin: "0 0 2px", color: "#60a5fa" }}>STK: <strong>{bankConfig.account_no}</strong></p>
              <p style={{ margin: "0", color: "#f59e0b" }}>Chủ TK: <strong>{bankConfig.account_name}</strong></p>
            </div>
          </div>
        </div>
      </section>

      {/* PAYMENT ORDERS & REVENUE SECTION */}
      <section style={{ marginBottom: "40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "20px", color: "#fff", margin: 0 }}>📊 Quản Lý Đơn Hàng & Doanh Thu ({orders.length})</h2>
          {orderStats && (
            <div style={{ display: "flex", gap: "12px" }}>
              <span style={{ backgroundColor: "#1b2e4b", color: "#10b981", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: "bold" }}>
                Doanh thu: {Number(orderStats.total_revenue_vnd).toLocaleString("vi-VN")}₫
              </span>
              <span style={{ backgroundColor: "#1b2e4b", color: "#60a5fa", padding: "6px 12px", borderRadius: "6px", fontSize: "13px", fontWeight: "bold" }}>
                Thành công: {orderStats.successful_orders}/{orderStats.total_orders} đơn
              </span>
            </div>
          )}
        </div>

        <div style={{ overflowX: "auto", backgroundColor: "#162822", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.1)" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.1)", color: "#a0b0a8" }}>
                <th style={{ padding: "12px 16px" }}>Mã Đơn</th>
                <th style={{ padding: "12px 16px" }}>Khách Hàng</th>
                <th style={{ padding: "12px 16px" }}>Gói Nạp</th>
                <th style={{ padding: "12px 16px" }}>Số Tiền</th>
                <th style={{ padding: "12px 16px" }}>Cổng TT</th>
                <th style={{ padding: "12px 16px" }}>Trạng Thái</th>
                <th style={{ padding: "12px 16px", textAlign: "right" }}>Thời Gian</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "20px", textAlign: "center", color: "#8aa095" }}>
                    Chưa có đơn hàng thanh toán nào.
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                    <td style={{ padding: "12px 16px", color: "#f59e0b", fontWeight: 700 }}>{o.order_code}</td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ color: "#fff" }}>{o.user_name}</span><br />
                      <small style={{ color: "#8aa095" }}>{o.user_email}</small>
                    </td>
                    <td style={{ padding: "12px 16px", color: "#fff" }}>
                      <strong>{o.package_name}</strong><br />
                      <small style={{ color: "#10b981" }}>+{o.credits} credits</small>
                    </td>
                    <td style={{ padding: "12px 16px", fontWeight: "bold", color: "#fff" }}>
                      {o.amount_vnd.toLocaleString("vi-VN")}₫
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{ backgroundColor: "rgba(255,255,255,0.08)", color: "#93c5fd", padding: "2px 6px", borderRadius: "4px", fontSize: "11px", fontWeight: 600 }}>
                        {o.gateway}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px" }}>
                      <span style={{
                        backgroundColor: o.status === "SUCCESS" ? "rgba(16,185,129,0.2)" : o.status === "FAILED" ? "rgba(239,68,68,0.2)" : "rgba(245,158,11,0.2)",
                        color: o.status === "SUCCESS" ? "#10b981" : o.status === "FAILED" ? "#ef4444" : "#f59e0b",
                        padding: "3px 8px", borderRadius: "4px", fontSize: "11px", fontWeight: "bold"
                      }}>
                        {o.status === "SUCCESS" ? "Thành Công" : o.status === "FAILED" ? "Thất Bại" : "Chờ TT"}
                      </span>
                    </td>
                    <td style={{ padding: "12px 16px", textAlign: "right", color: "#8aa095", fontSize: "12px" }}>
                      {new Date(o.paid_at || o.created_at).toLocaleString("vi-VN")}
                    </td>
                  </tr>
                ))
              )}
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
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await fetch(`/api/public/videos/${video.id}/download`);
                      if (!res.ok) throw new Error("Không thể tải video");
                      const blob = await res.blob();
                      const url = window.URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `${video.project_title || "video"}.mp4`;
                      document.body.appendChild(a);
                      a.click();
                      a.remove();
                      window.URL.revokeObjectURL(url);
                    } catch (err) { alert(errorText(err)); }
                  }}
                  style={{ flex: 1, textAlign: "center", backgroundColor: "#ff6b4a", color: "#fff", padding: "12px", borderRadius: "8px", border: "none", fontWeight: 700, fontSize: "15px", cursor: "pointer" }}
                >
                  ⬇ Tải Video MP4 Về Máy
                </button>
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

type TokenPackage = {
  id: string;
  name: string;
  credits: number;
  priceVnd: number;
  description: string;
  badge: string | null;
};

type PaymentOrderData = {
  order: {
    id: string;
    order_code: string;
    package_name: string;
    credits: number;
    amount_vnd: number;
    gateway: string;
    status: string;
  };
  vietqr?: {
    qrUrl: string;
    bankId: string;
    accountNo: string;
    accountName: string;
    memo: string;
    amount: number;
  } | null;
  vnpayUrl?: string | null;
  momo?: {
    payUrl: string;
    qrCodeUrl: string;
  } | null;
  isSandbox?: boolean;
};

function TokenShopModal({
  token,
  user,
  onPurchased,
  onClose,
}: {
  token: string;
  user: User;
  onPurchased: (updatedUser: User) => void;
  onClose: () => void;
}) {
  const [packages, setPackages] = useState<TokenPackage[]>([]);
  const [selectedPkg, setSelectedPkg] = useState<string>("pkg_pro");
  const [paymentMethod, setPaymentMethod] = useState<"vietqr" | "vnpay" | "momo" | "instant">("vietqr");
  const [loading, setLoading] = useState(true);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [currentOrderData, setCurrentOrderData] = useState<PaymentOrderData | null>(null);
  const [successMsg, setSuccessMsg] = useState("");
  const [promoInput, setPromoInput] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [promoError, setPromoError] = useState("");
  const [promoSuccess, setPromoSuccess] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    api<{ packages: TokenPackage[] }>("/api/billing/packages", {}, token)
      .then((data) => {
        setPackages(data.packages);
        if (data.packages[1]) setSelectedPkg(data.packages[1].id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  // Polling order status while an order is open
  useEffect(() => {
    if (!currentOrderData || currentOrderData.order.status === "SUCCESS") return;
    const interval = setInterval(async () => {
      try {
        const res = await api<{ order: { status: string; credits: number; order_code: string }; user?: User }>(
          `/api/billing/orders/${currentOrderData.order.order_code}/status`,
          {},
          token
        );
        if (res.order.status === "SUCCESS") {
          setSuccessMsg(`Đã nhận thanh toán thành công +${res.order.credits} Credits cho đơn ${res.order.order_code}!`);
          if (res.user) onPurchased(res.user);
          clearInterval(interval);
          setTimeout(() => onClose(), 2500);
        }
      } catch (err) {
        console.error("Order polling notice:", err);
      }
    }, 2500);

    return () => clearInterval(interval);
  }, [currentOrderData, token, onPurchased, onClose]);

  const activePkg = packages.find((p) => p.id === selectedPkg);

  async function handleStartPayment() {
    if (!activePkg) return;
    setCreatingOrder(true);
    try {
      const gatewayCode = paymentMethod === "instant" ? "SANDBOX" : paymentMethod.toUpperCase();
      const res = await api<PaymentOrderData>("/api/billing/create-order", {
        method: "POST",
        body: JSON.stringify({
          packageId: activePkg.id,
          gateway: gatewayCode,
        }),
      }, token);

      setCurrentOrderData(res);

      // If user selected instant sandbox, immediately complete it
      if (paymentMethod === "instant") {
        await handleCompleteSandbox(res.order.order_code);
      }
    } catch (err) {
      alert(errorText(err));
    } finally {
      setCreatingOrder(false);
    }
  }

  async function handleCompleteSandbox(orderCode: string) {
    try {
      const res = await api<{ success: boolean; user: User; message: string }>(
        `/api/billing/orders/${orderCode}/sandbox-complete`,
        { method: "POST" },
        token
      );
      setSuccessMsg(res.message);
      if (res.user) onPurchased(res.user);
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      alert(errorText(err));
    }
  }

  async function handleRedeemPromo(e: React.FormEvent) {
    e.preventDefault();
    if (!promoInput.trim()) return;
    setRedeeming(true);
    setPromoError("");
    setPromoSuccess("");
    try {
      const res = await api<{ success: boolean; user: User; message: string }>("/api/billing/redeem-promo", {
        method: "POST",
        body: JSON.stringify({ code: promoInput.trim() }),
      }, token);
      setPromoSuccess(res.message);
      onPurchased(res.user);
      setPromoInput("");
    } catch (err: any) {
      setPromoError(err?.message || errorText(err));
    } finally {
      setRedeeming(false);
    }
  }

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.85)", backdropFilter: "blur(10px)",
      display: "grid", placeItems: "center", zIndex: 1000, padding: "20px"
    }}>
      <div style={{
        backgroundColor: "#132238", border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: "20px", padding: "32px", maxWidth: "800px", width: "100%",
        maxHeight: "90vh", overflowY: "auto",
        boxShadow: "0 25px 60px rgba(0,0,0,0.6)",
        position: "relative",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
          <div>
            <span className="eyebrow" style={{ color: "#f59e0b" }}>💎 Cửa Hàng Credit & Cổng Thanh Toán</span>
            <h2 style={{ fontSize: "24px", color: "#fff", margin: "4px 0 2px" }}>Nạp Credit Render Video AI</h2>
            <p style={{ color: "#94a3b8", fontSize: "14px" }}>
              Số dư hiện tại: <strong style={{ color: "#f59e0b" }}>{user.credits} Credits</strong> · 1 Credit = 1 Lần Render Video AI hoàn chỉnh
            </p>
          </div>
          <button onClick={onClose} style={{ color: "#a0b0a8", fontSize: "24px", cursor: "pointer", background: "none", border: "none" }}>✕</button>
        </div>

        {successMsg ? (
          <div style={{
            backgroundColor: "#0d281e",
            border: "2px solid #10b981",
            borderRadius: "16px",
            padding: "36px 24px",
            textAlign: "center",
            color: "#6ee7b7",
            margin: "20px 0",
            boxShadow: "0 15px 40px rgba(16,185,129,0.25)"
          }}>
            <div style={{ fontSize: "56px", marginBottom: "12px" }}>🎉 💎 ✨</div>
            <h3 style={{ fontSize: "24px", color: "#fff", margin: "0 0 8px", fontWeight: 800 }}>Thanh Toán & Nạp Credit Thành Công!</h3>
            <p style={{ fontSize: "16px", color: "#a7f3d0", maxWidth: "520px", margin: "0 auto 20px" }}>
              {successMsg}
            </p>
            <div style={{
              backgroundColor: "rgba(0,0,0,0.35)",
              borderRadius: "12px",
              padding: "16px 24px",
              maxWidth: "380px",
              margin: "0 auto 24px",
              border: "1px solid rgba(16,185,129,0.3)"
            }}>
              <div style={{ fontSize: "13px", color: "#94a3b8", marginBottom: "4px" }}>Số Dư Credit Của Bạn:</div>
              <div style={{ fontSize: "32px", fontWeight: 900, color: "#f59e0b" }}>
                💎 {user.credits} <span style={{ fontSize: "16px", color: "#cbd5e1", fontWeight: 400 }}>Credits</span>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              style={{
                backgroundColor: "#10b981",
                color: "#fff",
                border: "none",
                borderRadius: "10px",
                padding: "14px 36px",
                fontSize: "16px",
                fontWeight: 800,
                cursor: "pointer",
                boxShadow: "0 4px 20px rgba(16,185,129,0.4)",
                transition: "transform 0.1s"
              }}
            >
              🚀 Bắt Đầu Tạo Video AI Ngay ➔
            </button>
          </div>
        ) : currentOrderData ? (
          /* LIVE ACTIVE ORDER PAYMENT SCREEN */
          <div style={{ backgroundColor: "#172740", borderRadius: "16px", padding: "24px", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.1)", paddingBottom: "14px", marginBottom: "20px" }}>
              <div>
                <span style={{ color: "#a0b0a8", fontSize: "12px" }}>Đơn hàng:</span>
                <h3 style={{ color: "#f59e0b", fontSize: "18px", margin: "2px 0 0" }}>{currentOrderData.order.order_code}</h3>
              </div>
              <div style={{ textAlign: "right" }}>
                <span style={{ color: "#a0b0a8", fontSize: "12px" }}>Số tiền thanh toán:</span>
                <h3 style={{ color: "#10b981", fontSize: "20px", margin: "2px 0 0" }}>{currentOrderData.order.amount_vnd.toLocaleString("vi-VN")}₫</h3>
              </div>
            </div>

            {/* VIETQR GATEWAY VIEW */}
            {currentOrderData.vietqr && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "24px", alignItems: "center" }}>
                <div style={{ textAlign: "center", backgroundColor: "#fff", padding: "16px", borderRadius: "14px" }}>
                  <img
                    src={currentOrderData.vietqr.qrUrl}
                    alt="VietQR Mã Thanh Toán"
                    style={{ width: "100%", maxWidth: "230px", height: "auto", display: "block", margin: "0 auto" }}
                  />
                  <small style={{ color: "#475569", fontWeight: 700, display: "block", marginTop: "8px" }}>
                    Quét bằng ứng dụng Ngân Hàng bất kỳ
                  </small>
                </div>

                <div>
                  <h4 style={{ color: "#fff", fontSize: "15px", marginBottom: "12px" }}>Thông Tin Chuyển Khoản Ngân Hàng:</h4>
                  
                  <div style={{ marginBottom: "10px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Ngân hàng thụ hưởng:</span>
                    <div style={{ color: "#fff", fontWeight: 700 }}>MB Bank (Ngân Hàng Quân Đội)</div>
                  </div>

                  <div style={{ marginBottom: "10px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Số tài khoản:</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ color: "#60a5fa", fontSize: "16px" }}>{currentOrderData.vietqr.accountNo}</strong>
                      <button
                        type="button"
                        onClick={() => copyText(currentOrderData.vietqr!.accountNo, "acc")}
                        style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", cursor: "pointer" }}
                      >
                        {copiedKey === "acc" ? "✓ Đã chép" : "Sao chép"}
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: "10px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Chủ tài khoản:</span>
                    <div style={{ color: "#fff", fontWeight: 700 }}>{currentOrderData.vietqr.accountName}</div>
                  </div>

                  <div style={{ marginBottom: "14px" }}>
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>Nội dung chuyển khoản (Bắt buộc chính xác):</span>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <strong style={{ color: "#f59e0b", fontSize: "16px", backgroundColor: "rgba(245,158,11,0.15)", padding: "2px 8px", borderRadius: "4px" }}>
                        {currentOrderData.vietqr.memo}
                      </strong>
                      <button
                        type="button"
                        onClick={() => copyText(currentOrderData.vietqr!.memo, "memo")}
                        style={{ backgroundColor: "rgba(255,255,255,0.1)", color: "#fff", border: "none", borderRadius: "4px", padding: "2px 8px", fontSize: "11px", cursor: "pointer" }}
                      >
                        {copiedKey === "memo" ? "✓ Đã chép" : "Sao chép"}
                      </button>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#10b981", fontSize: "13px", fontWeight: 600, marginBottom: "14px" }}>
                    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", backgroundColor: "#10b981", animation: "pulse 1.5s infinite" }}></span>
                    Đang tự động kiểm tra giao dịch từ ngân hàng...
                  </div>
                </div>
              </div>
            )}

            {/* VNPAY GATEWAY VIEW */}
            {currentOrderData.vnpayUrl && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <p style={{ color: "#cbd5e1", marginBottom: "16px" }}>
                  Bấm nút bên dưới để chuyển hướng đến cổng thanh toán bảo mật **VNPAY** (Hỗ trợ thẻ ATM nội địa, QR VNPAY, Visa/Mastercard):
                </p>
                <a
                  href={currentOrderData.vnpayUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-block",
                    backgroundColor: "#0066cc",
                    color: "#fff",
                    textDecoration: "none",
                    padding: "14px 28px",
                    borderRadius: "10px",
                    fontWeight: 700,
                    fontSize: "16px",
                    boxShadow: "0 4px 15px rgba(0,102,204,0.4)",
                    marginBottom: "16px"
                  }}
                >
                  🚀 Mở Cổng Thanh Toán VNPay ➔
                </a>
              </div>
            )}

            {/* MOMO GATEWAY VIEW */}
            {currentOrderData.momo && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <img
                  src={currentOrderData.momo.qrCodeUrl}
                  alt="MoMo QR"
                  style={{ width: "180px", height: "180px", borderRadius: "12px", display: "block", margin: "0 auto 12px" }}
                />
                <p style={{ color: "#cbd5e1", fontSize: "14px" }}>Mở ứng dụng MoMo trên điện thoại để quét mã QR thanh toán</p>
              </div>
            )}

            {/* ACTIONS & SANDBOX SIMULATOR */}
            <div style={{ display: "flex", gap: "10px", marginTop: "20px", borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "16px" }}>
              <button
                type="button"
                onClick={() => setCurrentOrderData(null)}
                style={{
                  backgroundColor: "rgba(255,255,255,0.08)",
                  color: "#cbd5e1",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  cursor: "pointer"
                }}
              >
                ← Quay lại chọn gói khác
              </button>

              <button
                type="button"
                onClick={() => handleCompleteSandbox(currentOrderData.order.order_code)}
                style={{
                  flex: 1,
                  background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  fontSize: "13px",
                  fontWeight: 700,
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(16,185,129,0.3)"
                }}
              >
                ⚡ [Mô Phỏng] Tôi Đã Chuyển Khoản / Xác Nhận Thanh Toán Ngay
              </button>
            </div>
          </div>
        ) : loading ? (
          <div style={{ padding: "40px", textAlign: "center", color: "#94a3b8" }}>Đang tải bảng giá Token...</div>
        ) : (
          <>
            {/* PROMO CODE REDEEM SECTION */}
            <div style={{
              backgroundColor: "#172740",
              border: "1px solid rgba(16,185,129,0.3)",
              borderRadius: "14px",
              padding: "16px 20px",
              marginBottom: "24px"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                <span style={{ fontSize: "16px" }}>🏷️</span>
                <strong style={{ fontSize: "14px", color: "#10b981" }}>Bạn Có Mã Khuyến Mãi / Voucher?</strong>
              </div>
              <form onSubmit={handleRedeemPromo} style={{ display: "flex", gap: "10px" }}>
                <input
                  type="text"
                  placeholder="Nhập mã (ví dụ: WELCOME2026)"
                  value={promoInput}
                  onChange={(e) => setPromoInput(e.target.value.toUpperCase())}
                  style={{
                    flex: 1,
                    backgroundColor: "#0d1624",
                    border: "1px solid rgba(255,255,255,0.2)",
                    borderRadius: "8px",
                    padding: "10px 14px",
                    color: "#fff",
                    fontSize: "14px",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    letterSpacing: "1px"
                  }}
                />
                <button
                  type="submit"
                  disabled={redeeming || !promoInput.trim()}
                  style={{
                    backgroundColor: "#10b981",
                    color: "#fff",
                    border: "none",
                    borderRadius: "8px",
                    padding: "10px 20px",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: redeeming || !promoInput.trim() ? "not-allowed" : "pointer",
                    boxShadow: "0 2px 10px rgba(16,185,129,0.3)"
                  }}
                >
                  {redeeming ? "Đang áp dụng..." : "Áp Dụng"}
                </button>
              </form>
              {promoSuccess && <p style={{ color: "#10b981", fontSize: "13px", margin: "8px 0 0", fontWeight: 600 }}>✓ {promoSuccess}</p>}
              {promoError && <p style={{ color: "#ef4444", fontSize: "13px", margin: "8px 0 0" }}>✕ {promoError}</p>}
            </div>

            {/* PRICING GRID */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
              gap: "14px",
              marginBottom: "24px"
            }}>
              {packages.map((pkg) => {
                const isSelected = selectedPkg === pkg.id;
                return (
                  <div
                    key={pkg.id}
                    onClick={() => setSelectedPkg(pkg.id)}
                    style={{
                      backgroundColor: isSelected ? "rgba(245, 158, 11, 0.1)" : "#1a2d4a",
                      border: isSelected ? "2px solid #f59e0b" : "1px solid rgba(255,255,255,0.1)",
                      borderRadius: "14px",
                      padding: "16px",
                      cursor: "pointer",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      position: "relative",
                      transition: "all 0.2s ease",
                      transform: isSelected ? "translateY(-2px)" : "none",
                      boxShadow: isSelected ? "0 8px 20px rgba(245, 158, 11, 0.2)" : "none",
                    }}
                  >
                    {pkg.badge && (
                      <span style={{
                        position: "absolute",
                        top: "-10px",
                        left: "50%",
                        transform: "translateX(-50%)",
                        backgroundColor: "#f59e0b",
                        color: "#000",
                        fontSize: "10px",
                        fontWeight: 800,
                        padding: "2px 8px",
                        borderRadius: "10px",
                        whiteSpace: "nowrap",
                      }}>
                        {pkg.badge}
                      </span>
                    )}

                    <div>
                      <h4 style={{ fontSize: "15px", color: "#fff", marginBottom: "4px" }}>{pkg.name}</h4>
                      <div style={{ fontSize: "22px", fontWeight: 800, color: "#f59e0b", marginBottom: "6px" }}>
                        +{pkg.credits} <small style={{ fontSize: "12px", color: "#94a3b8", fontWeight: 400 }}>Credits</small>
                      </div>
                      <p style={{ fontSize: "12px", color: "#94a3b8", lineHeight: 1.4, marginBottom: "12px" }}>
                        {pkg.description}
                      </p>
                    </div>

                    <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", paddingTop: "10px", textAlign: "center" }}>
                      <strong style={{ fontSize: "16px", color: "#fff" }}>
                        {pkg.priceVnd.toLocaleString("vi-VN")}₫
                      </strong>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* PAYMENT METHOD SELECTION */}
            <div style={{ backgroundColor: "#1b2e4b", borderRadius: "14px", padding: "20px", marginBottom: "24px" }}>
              <h4 style={{ fontSize: "14px", color: "#fff", marginBottom: "12px" }}>Chọn Cổng Thanh Toán Điện Tử:</h4>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: "10px", marginBottom: "8px" }}>
                <button
                  type="button"
                  onClick={() => setPaymentMethod("vietqr")}
                  style={{
                    backgroundColor: paymentMethod === "vietqr" ? "#10b981" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    border: paymentMethod === "vietqr" ? "1px solid #10b981" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px",
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span style={{ fontSize: "20px" }}>🏦</span>
                  <span>VietQR Ngân Hàng</span>
                  <small style={{ fontSize: "10px", opacity: 0.8 }}>(Tự động 24/7)</small>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("vnpay")}
                  style={{
                    backgroundColor: paymentMethod === "vnpay" ? "#0066cc" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    border: paymentMethod === "vnpay" ? "1px solid #0066cc" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px",
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span style={{ fontSize: "20px" }}>💳</span>
                  <span>Cổng VNPay</span>
                  <small style={{ fontSize: "10px", opacity: 0.8 }}>(ATM / VNPAY-QR)</small>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("momo")}
                  style={{
                    backgroundColor: paymentMethod === "momo" ? "#d82d8b" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    border: paymentMethod === "momo" ? "1px solid #d82d8b" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px",
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span style={{ fontSize: "20px" }}>📲</span>
                  <span>Ví MoMo</span>
                  <small style={{ fontSize: "10px", opacity: 0.8 }}>(Quét MoMo QR)</small>
                </button>

                <button
                  type="button"
                  onClick={() => setPaymentMethod("instant")}
                  style={{
                    backgroundColor: paymentMethod === "instant" ? "#f59e0b" : "rgba(255,255,255,0.06)",
                    color: "#fff",
                    border: paymentMethod === "instant" ? "1px solid #f59e0b" : "1px solid rgba(255,255,255,0.1)",
                    borderRadius: "10px",
                    padding: "12px",
                    fontWeight: 700,
                    fontSize: "13px",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: "4px"
                  }}
                >
                  <span style={{ fontSize: "20px" }}>⚡</span>
                  <span>Sandbox 1-Click</span>
                  <small style={{ fontSize: "10px", opacity: 0.8 }}>(Thử nghiệm nhanh)</small>
                </button>
              </div>
            </div>

            {/* ACTION BUTTON */}
            {activePkg && (
              <button
                type="button"
                onClick={handleStartPayment}
                disabled={creatingOrder}
                style={{
                  width: "100%",
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  color: "#fff",
                  border: "none",
                  borderRadius: "10px",
                  padding: "14px",
                  fontSize: "16px",
                  fontWeight: 800,
                  cursor: creatingOrder ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 15px rgba(245, 158, 11, 0.4)",
                  display: "flex",
                  justifyContent: "center",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                {creatingOrder ? "Đang tạo đơn thanh toán..." : `Tiến Hành Thanh Toán Gói +${activePkg.credits} Credits (${activePkg.priceVnd.toLocaleString("vi-VN")}₫) →`}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

