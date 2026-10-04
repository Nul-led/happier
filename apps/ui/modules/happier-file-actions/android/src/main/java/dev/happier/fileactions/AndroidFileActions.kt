package dev.happier.fileactions

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.util.Locale

class HappierDownloadFileProvider : FileProvider()

internal object AndroidFileActions {
  fun mimeType(name: String): String = MimeTypeMap.getSingleton()
    .getMimeTypeFromExtension(name.substringAfterLast('.', "").lowercase(Locale.ROOT))
    ?: "application/octet-stream"

  fun checkedDownloadFile(context: Context, fileUri: String): File {
    val uri = Uri.parse(fileUri)
    require(uri.scheme == "file") { "Only a downloaded local file can be opened or saved" }
    val file = File(requireNotNull(uri.path)).canonicalFile
    val root = File(context.cacheDir, "happier-downloads").canonicalFile
    require(file.path.startsWith(root.path + File.separator) && file.isFile) {
      "File is outside the download cache or no longer available"
    }
    return file
  }

  fun contentUri(context: Context, file: File, name: String): Uri = FileProvider.getUriForFile(
    context, context.packageName + ".happier-file-actions", file, name
  )

  fun documentIntent(name: String, mimeType: String): Intent = Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
    addCategory(Intent.CATEGORY_OPENABLE)
    type = mimeType
    putExtra(Intent.EXTRA_TITLE, name)
  }

  fun fileIntent(uri: Uri, name: String, share: Boolean): Intent = Intent(
    if (share) Intent.ACTION_SEND else Intent.ACTION_VIEW
  ).apply {
    val mimeType = mimeType(name)
    if (share) {
      type = mimeType
      putExtra(Intent.EXTRA_STREAM, uri)
    } else {
      setDataAndType(uri, mimeType)
    }
    clipData = ClipData.newRawUri(name, uri)
    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
  }
}
