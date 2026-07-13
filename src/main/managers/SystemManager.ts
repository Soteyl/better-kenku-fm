import { ipcMain, shell } from "electron";
import { fileURLToPath } from "node:url";

export class SystemManager {
  constructor() {
    ipcMain.on("SHELL_SHOW_ITEM_IN_FOLDER", this._handleShowItemInFolder);
    ipcMain.on("SHELL_OPEN_EXTERNAL", this._handleOpenExternal);
  }

  destroy() {
    ipcMain.off("SHELL_SHOW_ITEM_IN_FOLDER", this._handleShowItemInFolder);
    ipcMain.off("SHELL_OPEN_EXTERNAL", this._handleOpenExternal);
  }

  _handleShowItemInFolder = (_: Electron.IpcMainEvent, fileUrl: string) => {
    try {
      const filePath = fileUrl.startsWith("file://")
        ? fileURLToPath(fileUrl)
        : fileUrl;
      shell.showItemInFolder(filePath);
    } catch {
      // ignore invalid paths
    }
  };

  _handleOpenExternal = (_: Electron.IpcMainEvent, url: string) => {
    shell.openExternal(url).catch(() => {
      // ignore failures to open external URLs
    });
  };
}
