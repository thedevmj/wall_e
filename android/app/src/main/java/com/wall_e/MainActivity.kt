package com.wall_e

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    requestVideoPermissionIfNeeded()
  }

  private fun requestVideoPermissionIfNeeded() {
    val permission = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      Manifest.permission.READ_MEDIA_VIDEO
    } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      Manifest.permission.READ_EXTERNAL_STORAGE
    } else {
      return
    }

    if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) {
      requestPermissions(arrayOf(permission), VIDEO_PERMISSION_REQUEST_CODE)
    }
  }

  companion object {
    private const val VIDEO_PERMISSION_REQUEST_CODE = 4108
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "wall_e"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}
