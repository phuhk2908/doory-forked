import type { ExportFile } from './registry'

/** Download files one by one without loading the export pipelines that produced them. */
export function downloadFiles(files: readonly ExportFile[]): void {
  files.forEach((file, i) => {
    setTimeout(() => {
      const url = URL.createObjectURL(file.blob)
      const a = document.createElement('a')
      a.href = url
      a.download = file.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    }, i * 250)
  })
}
