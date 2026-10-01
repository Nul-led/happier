#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <stdio.h>
#include <unistd.h>

/* Isolated Xvfb fixture: no desktop/window outside this test display is touched. */
int main(void) {
  Display *display = XOpenDisplay(NULL);
  if (!display) return 2;
  Window root = DefaultRootWindow(display);
  Window window = XCreateSimpleWindow(display, root, 20, 20, 400, 240, 0, 0, 0xffffff);
  unsigned long pid = (unsigned long)getpid();
  XChangeProperty(display, window, XInternAtom(display, "_NET_WM_PID", False), XA_CARDINAL, 32, PropModeReplace, (unsigned char *)&pid, 1);
  XChangeProperty(display, root, XInternAtom(display, "_NET_CLIENT_LIST", False), XA_WINDOW, 32, PropModeReplace, (unsigned char *)&window, 1);
  XStoreName(display, window, "Happier native computer fixture");
  XSelectInput(display, window, ExposureMask | ButtonPressMask | ButtonReleaseMask | KeyPressMask | KeyReleaseMask);
  XMapWindow(display, window);
  XFlush(display);
  printf("window:%lu\n", window);
  fflush(stdout);
  int clicks = 0;
  for (;;) {
    XEvent event;
    XNextEvent(display, &event);
    if (event.type == ButtonRelease) {
      clicks++;
      printf("clicks:%d\n", clicks);
      fflush(stdout);
      XSetWindowBackground(display, window, 0x88ccff);
      XClearWindow(display, window);
    }
    if (event.type == Expose || event.type == ButtonRelease) {
      char label[64];
      int length = snprintf(label, sizeof(label), "Clicks: %d", clicks);
      XDrawString(display, window, DefaultGC(display, DefaultScreen(display)), 30, 40, label, length);
      XFlush(display);
    }
  }
}
