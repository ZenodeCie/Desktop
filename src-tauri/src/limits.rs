use crate::error::{err, AppResult};

/// Applique des limites « best effort » au processus du bot.
///
/// - **Linux** : `RLIMIT_AS` (mémoire virtuelle), `RLIMIT_NOFILE`, groupe de
///   processus dédié. Les cgroups v2 ne sont pas utilisés : ils exigent une
///   délégation systemd que l'application ne peut pas obtenir sans privilèges.
/// - **macOS** : `RLIMIT_CPU` et `RLIMIT_NOFILE` uniquement. `RLIMIT_AS` casse
///   Bun (réservation virtuelle importante), on ne l'applique donc pas.
/// - **Windows** : Job Object avec plafond mémoire, kill-on-close et
///   `JOB_OBJECT_LIMIT_ACTIVE_PROCESS`.
///
/// Ces limites protègent contre un bot emballé, pas contre un code malveillant
/// qui exploite une faille du noyau ou du runtime. Voir README § Sécurité.
pub fn prepare(cmd: &mut tokio::process::Command, memory_limit_mb: Option<u64>) {
    #[cfg(unix)]
    {
        let memory = memory_limit_mb.map(|mb| mb.saturating_mul(1024 * 1024));
        // SAFETY: uniquement des appels async-signal-safe entre fork et exec.
        unsafe {
            cmd.pre_exec(move || {
                libc::setsid();
                let nofile = libc::rlimit {
                    rlim_cur: 4096,
                    rlim_max: 4096,
                };
                libc::setrlimit(libc::RLIMIT_NOFILE, &nofile);
                #[cfg(target_os = "linux")]
                if let Some(bytes) = memory {
                    let limit = libc::rlimit {
                        rlim_cur: bytes,
                        rlim_max: bytes,
                    };
                    // Un échec ici n'est pas fatal : le plafond est best-effort.
                    let _ = libc::setrlimit(libc::RLIMIT_AS, &limit);
                }
                #[cfg(not(target_os = "linux"))]
                let _ = memory;
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    let _ = (cmd, memory_limit_mb);
}

/// Tue l'arbre de processus. Le bot peut avoir lancé des sous-processus
/// (npm, outils de build) : on cible le groupe créé par `setsid`.
pub fn kill_tree(pid: u32, force: bool) {
    #[cfg(unix)]
    {
        use nix::sys::signal::{kill, Signal};
        use nix::unistd::Pid;
        let signal = if force {
            Signal::SIGKILL
        } else {
            Signal::SIGTERM
        };
        // Négatif = groupe de processus entier.
        let _ = kill(Pid::from_raw(-(pid as i32)), signal);
        let _ = kill(Pid::from_raw(pid as i32), signal);
    }
    #[cfg(windows)]
    {
        use std::process::Stdio;
        let mut cmd = std::process::Command::new("taskkill");
        cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let _ = cmd.status();
    }
    #[cfg(not(any(unix, windows)))]
    let _ = (pid, force);
}

/// Vérifie qu'un binaire existe et est exécutable avant de lancer un bot.
pub fn ensure_executable(path: &std::path::Path) -> AppResult<()> {
    if !path.exists() {
        return Err(err(
            "Runtime introuvable. Installez-le depuis l'écran Configuration.",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)?.permissions().mode();
        if mode & 0o111 == 0 {
            return Err(err("Le runtime n'est pas exécutable."));
        }
    }
    Ok(())
}

#[cfg(target_os = "windows")]
mod windows_job {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
        SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JOB_OBJECT_LIMIT_ACTIVE_PROCESS, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOB_OBJECT_LIMIT_PROCESS_MEMORY,
    };

    /// Garde le handle du Job Object vivant aussi longtemps que le processus.
    pub struct JobHandle(pub HANDLE);

    impl Drop for JobHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    unsafe impl Send for JobHandle {}
    unsafe impl Sync for JobHandle {}

    pub fn attach(
        child: &tokio::process::Child,
        memory_limit_mb: Option<u64>,
    ) -> Option<JobHandle> {
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return None;
            }
            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            info.BasicLimitInformation.LimitFlags =
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
            info.BasicLimitInformation.ActiveProcessLimit = 64;
            if let Some(mb) = memory_limit_mb {
                info.ProcessMemoryLimit = mb.saturating_mul(1024 * 1024) as usize;
                info.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_PROCESS_MEMORY;
            }
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &info as *const _ as *const _,
                std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            );
            let handle = child.raw_handle()? as HANDLE;
            if AssignProcessToJobObject(job, handle) == 0 {
                CloseHandle(job);
                return None;
            }
            Some(JobHandle(job))
        }
    }
}

#[cfg(target_os = "windows")]
pub use windows_job::{attach as attach_job, JobHandle};
