//go:build windows

package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const (
	createSuspended = 0x00000004
	createNoWindow  = 0x08000000

	jobObjectExtendedLimitInformationClass = 9
	jobObjectLimitKillOnJobClose           = 0x00002000
)

type jobObjectBasicLimitInformation struct {
	PerProcessUserTimeLimit int64
	PerJobUserTimeLimit     int64
	LimitFlags              uint32
	MinimumWorkingSetSize   uintptr
	MaximumWorkingSetSize   uintptr
	ActiveProcessLimit      uint32
	Affinity                uintptr
	PriorityClass           uint32
	SchedulingClass         uint32
}

type ioCounters struct {
	ReadOperationCount  uint64
	WriteOperationCount uint64
	OtherOperationCount uint64
	ReadTransferCount   uint64
	WriteTransferCount  uint64
	OtherTransferCount  uint64
}

type jobObjectExtendedLimitInformation struct {
	BasicLimitInformation jobObjectBasicLimitInformation
	IoInfo                ioCounters
	ProcessMemoryLimit    uintptr
	JobMemoryLimit        uintptr
	PeakProcessMemoryUsed uintptr
	PeakJobMemoryUsed     uintptr
}

type processResult struct {
	code uint32
	err  error
}

var kernel32 = syscall.NewLazyDLL("kernel32.dll")

var (
	assignProcessToJobObject = kernel32.NewProc("AssignProcessToJobObject")
	createJobObject          = kernel32.NewProc("CreateJobObjectW")
	resumeThread             = kernel32.NewProc("ResumeThread")
	setInformationJobObject  = kernel32.NewProc("SetInformationJobObject")
)

func main() {
	code, err := run(os.Args[1:])
	if err != nil {
		_, _ = fmt.Fprintln(os.Stderr, "radiora-surreal:", err)
		if code == 0 {
			code = 1
		}
	}
	os.Exit(code)
}

func run(args []string) (int, error) {
	executable, err := os.Executable()
	if err != nil {
		return 1, fmt.Errorf("resolve wrapper path: %w", err)
	}
	surrealPath := filepath.Join(filepath.Dir(executable), "surreal.exe")
	if info, statErr := os.Stat(surrealPath); statErr != nil || info.IsDir() {
		if statErr != nil {
			return 1, fmt.Errorf("find %s: %w", surrealPath, statErr)
		}
		return 1, fmt.Errorf("find %s: path is a directory", surrealPath)
	}

	job, err := newKillOnCloseJob()
	if err != nil {
		return 1, err
	}
	defer closeHandle(&job)

	stdinRead, stdinWrite, err := newPipe()
	if err != nil {
		return 1, fmt.Errorf("create stdin pipe: %w", err)
	}
	stdoutRead, stdoutWrite, err := newPipe()
	if err != nil {
		closeHandle(&stdinRead)
		closeHandle(&stdinWrite)
		return 1, fmt.Errorf("create stdout pipe: %w", err)
	}
	stderrRead, stderrWrite, err := newPipe()
	if err != nil {
		closeHandle(&stdinRead)
		closeHandle(&stdinWrite)
		closeHandle(&stdoutRead)
		closeHandle(&stdoutWrite)
		return 1, fmt.Errorf("create stderr pipe: %w", err)
	}
	defer func() {
		closeHandle(&stdinRead)
		closeHandle(&stdinWrite)
		closeHandle(&stdoutRead)
		closeHandle(&stdoutWrite)
		closeHandle(&stderrRead)
		closeHandle(&stderrWrite)
	}()

	standardInput, _ := syscall.GetStdHandle(syscall.STD_INPUT_HANDLE)
	standardOutput, _ := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE)
	standardError, _ := syscall.GetStdHandle(syscall.STD_ERROR_HANDLE)
	clearInherited(standardInput)
	clearInherited(standardOutput)
	clearInherited(standardError)
	if err := syscall.SetHandleInformation(stdinWrite, syscall.HANDLE_FLAG_INHERIT, 0); err != nil {
		return 1, fmt.Errorf("make stdin writer private: %w", err)
	}
	if err := syscall.SetHandleInformation(stdoutRead, syscall.HANDLE_FLAG_INHERIT, 0); err != nil {
		return 1, fmt.Errorf("make stdout reader private: %w", err)
	}
	if err := syscall.SetHandleInformation(stderrRead, syscall.HANDLE_FLAG_INHERIT, 0); err != nil {
		return 1, fmt.Errorf("make stderr reader private: %w", err)
	}

	applicationName, err := syscall.UTF16PtrFromString(surrealPath)
	if err != nil {
		return 1, fmt.Errorf("encode executable path: %w", err)
	}
	commandLine, err := syscall.UTF16FromString(buildCommandLine(surrealPath, args))
	if err != nil {
		return 1, fmt.Errorf("encode command line: %w", err)
	}
	startup := syscall.StartupInfo{
		Cb:         uint32(unsafe.Sizeof(syscall.StartupInfo{})),
		Flags:      syscall.STARTF_USESTDHANDLES | syscall.STARTF_USESHOWWINDOW,
		ShowWindow: syscall.SW_HIDE,
		StdInput:   stdinRead,
		StdOutput:  stdoutWrite,
		StdErr:     stderrWrite,
	}
	var processInfo syscall.ProcessInformation
	creationFlags := uint32(createSuspended | createNoWindow | syscall.CREATE_UNICODE_ENVIRONMENT)
	if err := syscall.CreateProcess(
		applicationName,
		&commandLine[0],
		nil,
		nil,
		true,
		creationFlags,
		nil,
		nil,
		&startup,
		&processInfo,
	); err != nil {
		return 1, fmt.Errorf("start surreal.exe: %w", err)
	}
	defer syscall.CloseHandle(processInfo.Thread)
	defer syscall.CloseHandle(processInfo.Process)

	// The child owns these ends. Keeping them open in the wrapper would prevent EOF on the relays.
	closeHandle(&stdinRead)
	closeHandle(&stdoutWrite)
	closeHandle(&stderrWrite)
	if err := assignToJob(job, processInfo.Process); err != nil {
		_ = syscall.TerminateProcess(processInfo.Process, 1)
		_, _ = waitForProcess(processInfo.Process)
		return 1, err
	}
	if err := resume(processInfo.Thread); err != nil {
		_ = syscall.TerminateProcess(processInfo.Process, 1)
		_, _ = waitForProcess(processInfo.Process)
		return 1, err
	}

	stdinWriter := os.NewFile(uintptr(stdinWrite), "surreal stdin")
	stdinWrite = syscall.InvalidHandle
	stdoutReader := os.NewFile(uintptr(stdoutRead), "surreal stdout")
	stdoutRead = syscall.InvalidHandle
	stderrReader := os.NewFile(uintptr(stderrRead), "surreal stderr")
	stderrRead = syscall.InvalidHandle
	stdinDone := make(chan struct{})
	go relayInput(stdinWriter, stdinDone)
	stdoutDone := relayOutput(stdoutReader, os.Stdout)
	stderrDone := relayOutput(stderrReader, os.Stderr)
	waitDone := make(chan processResult, 1)
	go func() {
		code, waitErr := waitForProcess(processInfo.Process)
		waitDone <- processResult{code: code, err: waitErr}
	}()

	var result processResult
	if len(args) == 0 || args[0] != "start" {
		result = <-waitDone
	} else {
		select {
		case result = <-waitDone:
		case <-stdinDone:
			select {
			case result = <-waitDone:
			case <-time.After(500 * time.Millisecond):
				_ = syscall.TerminateProcess(processInfo.Process, 1)
				result = <-waitDone
			}
		}
	}
	<-stdoutDone
	<-stderrDone
	if result.err != nil {
		return int(result.code), result.err
	}
	return int(result.code), nil
}

func newPipe() (syscall.Handle, syscall.Handle, error) {
	security := &syscall.SecurityAttributes{
		Length:        uint32(unsafe.Sizeof(syscall.SecurityAttributes{})),
		InheritHandle: 1,
	}
	var readHandle, writeHandle syscall.Handle
	if err := syscall.CreatePipe(&readHandle, &writeHandle, security, 0); err != nil {
		return syscall.InvalidHandle, syscall.InvalidHandle, err
	}
	return readHandle, writeHandle, nil
}

func newKillOnCloseJob() (syscall.Handle, error) {
	job, _, callErr := createJobObject.Call(0, 0)
	if job == 0 {
		return syscall.InvalidHandle, callError("CreateJobObjectW", callErr)
	}
	limits := jobObjectExtendedLimitInformation{
		BasicLimitInformation: jobObjectBasicLimitInformation{LimitFlags: jobObjectLimitKillOnJobClose},
	}
	result, _, callErr := setInformationJobObject.Call(
		job,
		jobObjectExtendedLimitInformationClass,
		uintptr(unsafe.Pointer(&limits)),
		unsafe.Sizeof(limits),
	)
	if result == 0 {
		handle := syscall.Handle(job)
		closeHandle(&handle)
		return syscall.InvalidHandle, callError("SetInformationJobObject", callErr)
	}
	return syscall.Handle(job), nil
}

func assignToJob(job, process syscall.Handle) error {
	result, _, callErr := assignProcessToJobObject.Call(uintptr(job), uintptr(process))
	if result == 0 {
		return callError("AssignProcessToJobObject", callErr)
	}
	return nil
}

func resume(thread syscall.Handle) error {
	result, _, callErr := resumeThread.Call(uintptr(thread))
	if result == ^uintptr(0) {
		return callError("ResumeThread", callErr)
	}
	return nil
}

func waitForProcess(process syscall.Handle) (uint32, error) {
	result, err := syscall.WaitForSingleObject(process, syscall.INFINITE)
	if err != nil || result != syscall.WAIT_OBJECT_0 {
		if err == nil {
			err = fmt.Errorf("unexpected wait result 0x%x", result)
		}
		return 1, fmt.Errorf("wait for surreal.exe: %w", err)
	}
	var code uint32
	if err := syscall.GetExitCodeProcess(process, &code); err != nil {
		return 1, fmt.Errorf("read surreal.exe exit code: %w", err)
	}
	return code, nil
}

func relayInput(writer *os.File, done chan<- struct{}) {
	_, _ = io.Copy(writer, os.Stdin)
	_ = writer.Close()
	close(done)
}

func relayOutput(reader, writer *os.File) <-chan struct{} {
	done := make(chan struct{})
	go func() {
		_, _ = io.Copy(writer, reader)
		_ = reader.Close()
		close(done)
	}()
	return done
}

func buildCommandLine(executable string, args []string) string {
	parts := make([]string, 0, len(args)+1)
	parts = append(parts, quoteWindowsArgument(executable))
	for _, arg := range args {
		parts = append(parts, quoteWindowsArgument(arg))
	}
	return strings.Join(parts, " ")
}

func quoteWindowsArgument(value string) string {
	if value != "" && !strings.ContainsAny(value, " \t\"") {
		return value
	}
	var builder strings.Builder
	builder.WriteByte('"')
	backslashes := 0
	for _, char := range value {
		if char == '\\' {
			backslashes++
			continue
		}
		if char == '"' {
			builder.WriteString(strings.Repeat("\\", backslashes*2+1))
			builder.WriteRune(char)
			backslashes = 0
			continue
		}
		builder.WriteString(strings.Repeat("\\", backslashes))
		builder.WriteRune(char)
		backslashes = 0
	}
	builder.WriteString(strings.Repeat("\\", backslashes*2))
	builder.WriteByte('"')
	return builder.String()
}

func clearInherited(handle syscall.Handle) {
	if handle == 0 || handle == syscall.InvalidHandle {
		return
	}
	_ = syscall.SetHandleInformation(handle, syscall.HANDLE_FLAG_INHERIT, 0)
}

func closeHandle(handle *syscall.Handle) {
	if *handle == 0 || *handle == syscall.InvalidHandle {
		return
	}
	_ = syscall.CloseHandle(*handle)
	*handle = syscall.InvalidHandle
}

func callError(name string, callErr error) error {
	if callErr == nil {
		callErr = syscall.GetLastError()
	}
	return fmt.Errorf("%s: %w", name, callErr)
}
