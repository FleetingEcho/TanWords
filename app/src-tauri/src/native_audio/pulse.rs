#![cfg(target_os = "linux")]

use libloading::Library;
use std::ffi::{c_char, c_int, c_void, CString};

#[repr(C)]
struct SampleSpec {
    format: i32,
    rate: u32,
    channels: u8,
}
type NewFn = unsafe extern "C" fn(
    *const c_char,
    *const c_char,
    i32,
    *const c_char,
    *const c_char,
    *const SampleSpec,
    *const c_void,
    *const c_void,
    *mut c_int,
) -> *mut c_void;
type WriteFn = unsafe extern "C" fn(*mut c_void, *const c_void, usize, *mut c_int) -> c_int;
type OpFn = unsafe extern "C" fn(*mut c_void, *mut c_int) -> c_int;
type LatencyFn = unsafe extern "C" fn(*mut c_void, *mut c_int) -> u64;
type FreeFn = unsafe extern "C" fn(*mut c_void);

pub(crate) struct Output {
    _library: Library,
    handle: *mut c_void,
    write: WriteFn,
    flush: OpFn,
    drain: OpFn,
    latency: LatencyFn,
    free: FreeFn,
}
unsafe impl Send for Output {}

impl Output {
    pub fn open(rate: u32, channels: u16) -> Result<Self, String> {
        let library = unsafe { Library::new("libpulse-simple.so.0") }.map_err(|e| e.to_string())?;
        let new: NewFn = unsafe { *library.get(b"pa_simple_new\0").map_err(|e| e.to_string())? };
        let write = unsafe {
            *library
                .get(b"pa_simple_write\0")
                .map_err(|e| e.to_string())?
        };
        let flush = unsafe {
            *library
                .get(b"pa_simple_flush\0")
                .map_err(|e| e.to_string())?
        };
        let drain = unsafe {
            *library
                .get(b"pa_simple_drain\0")
                .map_err(|e| e.to_string())?
        };
        let latency = unsafe {
            *library
                .get(b"pa_simple_get_latency\0")
                .map_err(|e| e.to_string())?
        };
        let free = unsafe {
            *library
                .get(b"pa_simple_free\0")
                .map_err(|e| e.to_string())?
        };
        let name = CString::new("TanWords").unwrap();
        let stream = CString::new("Local music").unwrap();
        let spec = SampleSpec {
            format: 5,
            rate,
            channels: channels as u8,
        }; // PA_SAMPLE_FLOAT32LE
        let mut error = 0;
        let handle = unsafe {
            new(
                std::ptr::null(),
                name.as_ptr(),
                1,
                std::ptr::null(),
                stream.as_ptr(),
                &spec,
                std::ptr::null(),
                std::ptr::null(),
                &mut error,
            )
        };
        if handle.is_null() {
            return Err(format!("PulseAudio open failed ({error})"));
        }
        Ok(Self {
            _library: library,
            handle,
            write,
            flush,
            drain,
            latency,
            free,
        })
    }
    pub fn write(&mut self, samples: &[f32]) -> Result<(), String> {
        let mut error = 0;
        let result = unsafe {
            (self.write)(
                self.handle,
                samples.as_ptr().cast(),
                std::mem::size_of_val(samples),
                &mut error,
            )
        };
        if result < 0 {
            Err(format!("PulseAudio write failed ({error})"))
        } else {
            Ok(())
        }
    }
    pub fn flush(&mut self) {
        let mut e = 0;
        unsafe {
            (self.flush)(self.handle, &mut e);
        }
    }
    pub fn drain(&mut self) {
        let mut e = 0;
        unsafe {
            (self.drain)(self.handle, &mut e);
        }
    }
    pub fn latency_sec(&mut self) -> f64 {
        let mut error = 0;
        unsafe { (self.latency)(self.handle, &mut error) as f64 / 1_000_000.0 }
    }
}
impl Drop for Output {
    fn drop(&mut self) {
        unsafe {
            (self.free)(self.handle);
        }
    }
}
