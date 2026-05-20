import simpleGit, { type SimpleGit } from "simple-git";

export class GitRepo {
  private git: SimpleGit;
  constructor(cwd: string) {
    this.git = simpleGit({ baseDir: cwd });
  }

  async configureBot(): Promise<void> {
    await this.git.addConfig("user.name", "sentry-errors-fixer[bot]");
    await this.git.addConfig("user.email", "sentry-errors-fixer@users.noreply.github.com");
  }

  async defaultBranch(): Promise<string> {
    const remoteHead = await this.git.revparse(["--abbrev-ref", "origin/HEAD"]).catch(() => "");
    if (remoteHead && remoteHead.includes("/")) return remoteHead.split("/").slice(1).join("/");
    return (await this.git.revparse(["--abbrev-ref", "HEAD"])).trim();
  }

  async remoteBranchExists(branch: string): Promise<boolean> {
    const out = await this.git.listRemote(["--heads", "origin", branch]);
    return out.trim().length > 0;
  }

  async checkoutNewBranch(branch: string, base: string): Promise<void> {
    await this.git.fetch("origin", base);
    await this.git.checkout(["-B", branch, `origin/${base}`]);
  }

  async hasChanges(): Promise<boolean> {
    const status = await this.git.status();
    return !status.isClean();
  }

  async commitAll(message: string): Promise<void> {
    await this.git.add(["-A"]);
    await this.git.commit(message);
  }

  async push(branch: string): Promise<void> {
    await this.git.push("origin", branch, ["--set-upstream"]);
  }

  async revparse(ref: string): Promise<string> {
    return (await this.git.revparse([ref])).trim();
  }

  async commitsSince(baseSha: string): Promise<{ hash: string; message: string }[]> {
    const log = await this.git.log({ from: baseSha, to: "HEAD" });
    return log.all.map((c) => ({ hash: c.hash, message: c.message }));
  }

  async resetHard(ref: string): Promise<void> {
    await this.git.reset(["--hard", ref]);
    await this.git.clean("f", ["-d"]);
  }
}
