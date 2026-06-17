export type ServicePlatform = "darwin" | "win32";

export interface ServiceStatus {
  platform: ServicePlatform | "unsupported";
  installed: boolean;
  running: boolean;
  logPath: string;
  registrationPath?: string;
  startError?: string | null;
}
